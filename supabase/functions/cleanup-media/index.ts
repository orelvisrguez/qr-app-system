import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  if (!serviceRoleKey || !url || request.headers.get('authorization') !== `Bearer ${serviceRoleKey}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: deletedEvents, error: cleanupError } = await service.rpc('cleanup_old_ring_events')
  if (cleanupError) {
    console.error('Could not expire old events and invitations:', cleanupError.message)
    return Response.json({ error: 'cleanup_failed' }, { status: 500 })
  }

  const { data: queuedPhotos, error: queueError } = await service
    .from('visitor_media_cleanup')
    .select('path')
    .order('queued_at')
    .limit(100)
  if (queueError) {
    console.error('Could not load expired visitor photos:', queueError.message)
    return Response.json({ error: 'photo_queue_failed' }, { status: 500 })
  }

  const paths = (queuedPhotos ?? []).map((row) => row.path)
  if (paths.length) {
    const { error: storageError } = await service.storage.from('visitor-photos').remove(paths)
    if (storageError) {
      console.error('Could not remove expired visitor photos:', storageError.message)
      return Response.json({ error: 'photo_cleanup_failed' }, { status: 500 })
    }
    const { error: queueDeleteError } = await service
      .from('visitor_media_cleanup')
      .delete()
      .in('path', paths)
    if (queueDeleteError) {
      console.error('Photos were removed but cleanup queue could not be updated:', queueDeleteError.message)
      return Response.json({ error: 'photo_queue_update_failed' }, { status: 500 })
    }
  }

  return Response.json({ deleted_events: deletedEvents ?? 0, deleted_photos: paths.length })
})
