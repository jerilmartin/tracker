'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { MapPin, Play, Square, Camera, Clock, LogOut, User, CheckCircle, AlertCircle, Loader2, Wifi, WifiOff, CloudLightning } from 'lucide-react'
import type { Profile, Session, GeoLocation, PhotoCheckin } from '@/lib/types'
import { formatDistanceToNow, format } from 'date-fns'
import { queuePhoto, getQueuedPhotos, removeQueuedPhoto, type QueuedPhoto } from '@/lib/offline'
import { motion, AnimatePresence } from 'framer-motion'

export default function UserDashboard() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [pastSessions, setPastSessions] = useState<Session[]>([])
  const [checkins, setCheckins] = useState<PhotoCheckin[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [nextCheckinIn, setNextCheckinIn] = useState<number | null>(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)
  const [elapsedTime, setElapsedTime] = useState('')
  const checkinTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getLocation = (): Promise<GeoLocation> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })
  }

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (prof) setProfile(prof)

    const { data: sessions } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (sessions) {
      const active = sessions.find(s => s.status === 'active') || null
      setActiveSession(active)
      setPastSessions(sessions.filter(s => s.status !== 'active'))
    }
  }, [supabase, router])

  // Checkin tracking
  const [lastCheckinAt, setLastCheckinAt] = useState<string | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null)

  const loadCheckins = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from('photo_checkins')
      .select('*')
      .eq('session_id', sessionId)
      .order('captured_at', { ascending: false })
    if (data) {
      setCheckins(data)
      if (data.length > 0) {
        setLastCheckinAt(data[0].captured_at)
      }
    }
  }, [supabase])

  // Setup checkin reminder and cooldown based on last checkin
  const setupCheckinTimer = useCallback(() => {
    if (checkinTimerRef.current) clearInterval(checkinTimerRef.current)

    const REMINDER_PERIOD = 60 * 60 * 1000 // 1 hour inactivity reminder
    
    const updateTimers = () => {
      // Inactivity reminder logic
      if (lastCheckinAt) {
        const last = new Date(lastCheckinAt).getTime()
        const elapsed = Date.now() - last
        
        // Reminder logic: If 60 mins passed since last checkin, and no modal open, remind them.
        if (elapsed >= REMINDER_PERIOD && elapsed < REMINDER_PERIOD + 2000) {
          setShowPhotoModal(true)
        }
        
        // Next checkin countdown (for visual indicator only)
        const nextTarget = last + REMINDER_PERIOD
        setNextCheckinIn(Math.max(0, Math.floor((nextTarget - Date.now()) / 1000)))
        setCooldownRemaining(null) // Always allow uploads
      } else if (activeSession) {
        // No checkins yet - initial requirement
        setNextCheckinIn(0)
        setCooldownRemaining(null)
      }
    }

    updateTimers()
    checkinTimerRef.current = setInterval(updateTimers, 1000)
  }, [lastCheckinAt, activeSession])

  const setupElapsedTimer = useCallback((startTime: string) => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)

    const update = () => {
      const start = new Date(startTime).getTime()
      const elapsed = Date.now() - start
      const h = Math.floor(elapsed / 3600000)
      const m = Math.floor((elapsed % 3600000) / 60000)
      const s = Math.floor((elapsed % 60000) / 1000)
      setElapsedTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    update()
    elapsedTimerRef.current = setInterval(update, 1000)
  }, [])

  useEffect(() => {
    setLoading(true)
    loadData().finally(() => setLoading(false))
    return () => {
      if (checkinTimerRef.current) clearInterval(checkinTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    }
  }, [loadData])

  useEffect(() => {
    if (activeSession) {
      setupCheckinTimer()
      setupElapsedTimer(activeSession.start_time)
      loadCheckins(activeSession.id)
    } else {
      setLastCheckinAt(null)
      setCooldownRemaining(null)
      if (checkinTimerRef.current) clearInterval(checkinTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      setElapsedTime('')
      setNextCheckinIn(null)
    }
  }, [activeSession, setupCheckinTimer, setupElapsedTimer, loadCheckins])

  // Force photo modal on session start if no photo taken yet
  useEffect(() => {
    if (activeSession && !lastCheckinAt && !loading) {
      setShowPhotoModal(true)
    }
  }, [activeSession, lastCheckinAt, loading])

  // Handle online/offline and sync
  const syncQueuedPhotos = useCallback(async () => {
    if (!navigator.onLine || syncing) return
    const queued = await getQueuedPhotos()
    if (queued.length === 0) {
      setQueuedCount(0)
      return
    }

    setSyncing(true)
    setQueuedCount(queued.length)
    
    let successCount = 0
    for (const item of queued) {
      try {
        const fileName = item.fileName
        const { error: uploadError } = await supabase.storage
          .from('field-photos')
          .upload(fileName, item.file, { upsert: true })

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage.from('field-photos').getPublicUrl(fileName)

        const { data: checkinData, error: checkinError } = await supabase.from('photo_checkins').insert({
          session_id: item.sessionId,
          user_id: item.userId,
          photo_url: publicUrl,
          location: item.location,
          captured_at: new Date(item.timestamp).toISOString()
        }).select().single()
        if (checkinError) throw checkinError

        if (checkinData) {
          setCheckins(prev => [checkinData, ...prev])
          setLastCheckinAt(checkinData.captured_at)
        }

        await removeQueuedPhoto(item.id)
        successCount++
      } catch (err) {
        console.error('Failed to sync photo:', err)
      }
    }
    
    if (successCount > 0) {
      setSuccess(`Successfully synced ${successCount} offline photos!`)
      setTimeout(() => setSuccess(''), 4000)
    }

    const remaining = await getQueuedPhotos()
    setQueuedCount(remaining.length)
    setSyncing(false)
    if (activeSession) loadCheckins(activeSession.id)
  }, [supabase, activeSession, loadCheckins, syncing])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // Small delay to ensure connection is actually stable
      setTimeout(syncQueuedPhotos, 2000)
    }
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)
    
    // Check for queued items on mount and try to sync
    getQueuedPhotos().then(items => {
      setQueuedCount(items.length)
      if (items.length > 0 && navigator.onLine) syncQueuedPhotos()
    })
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [syncQueuedPhotos])

  const startSession = async () => {
    setActionLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const location = await getLocation()
      const { data, error: err } = await supabase.from('sessions').insert({
        user_id: user.id,
        start_location: location,
        status: 'active',
      }).select().single()
      if (err) throw err
      setActiveSession(data)
      setSuccess('Session started! Please upload your starting photo.')
      setShowPhotoModal(true)
      setTimeout(() => setSuccess(''), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start session')
    } finally {
      setActionLoading(false)
    }
  }

  // Handle history for photo modal (fix for swiping back on mobile)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (showPhotoModal) {
        setShowPhotoModal(false) // Close modal on back button
      }
    }
    if (showPhotoModal) {
      window.history.pushState({ modal: 'photo-upload' }, '')
      window.addEventListener('popstate', handlePopState)
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [showPhotoModal])

  const endSession = async () => {
    if (!activeSession) return
    if (!confirm('Are you sure you want to end this session?')) return
    
    setActionLoading(true)
    setError('')
    
    try {
      // 1. Capture final location (with fallback)
      const location = await getLocation().catch(() => null)
      
      // 2. Update session in Supabase
      const { error: err } = await supabase
        .from('sessions')
        .update({
          end_location: location,
          end_time: new Date().toISOString(),
          status: 'ended',
        })
        .eq('id', activeSession.id)
      
      if (err) throw new Error(`Database Error: ${err.message}`)
      
      // 3. Clear local state and refresh
      setActiveSession(null)
      setSuccess('Session ended. Great work today!')
      setTimeout(() => setSuccess(''), 3000)
      
      // Force reload to ensure history is updated
      await loadData()
      
    } catch (e: unknown) {
      console.error('End session error:', e)
      setError(e instanceof Error ? e.message : 'Failed to end session. Check connection.')
    } finally {
      setActionLoading(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeSession) return
    
    setPhotoUploading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const fileName = `checkins/${user.id}/${activeSession.id}/${Date.now()}.jpg`
      
      let location: GeoLocation | null = null
      try { location = await getLocation() } catch { /* optional */ }

      if (!navigator.onLine) {
        // Queue it locally
        await queuePhoto({
          id: crypto.randomUUID(),
          userId: user.id,
          sessionId: activeSession.id,
          file,
          fileName,
          timestamp: Date.now(),
          location: location || undefined
        })
        setQueuedCount(prev => prev + 1)
        setShowPhotoModal(false)
        setSuccess('Offline mode: Photo saved locally and will sync when reconnected.')
        setTimeout(() => setSuccess(''), 5000)
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('field-photos')
        .upload(fileName, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('field-photos').getPublicUrl(fileName)

      const { data: checkinData, error: checkinError } = await supabase.from('photo_checkins').insert({
        session_id: activeSession.id,
        user_id: user.id,
        photo_url: publicUrl,
        location,
      }).select().single()
      if (checkinError) throw checkinError

      if (checkinData) {
        setCheckins(prev => [checkinData, ...prev])
        setLastCheckinAt(checkinData.captured_at)
      }

      setShowPhotoModal(false)
      setSuccess('Photo check-in submitted successfully!')
      setTimeout(() => setSuccess(''), 3000)
      loadCheckins(activeSession.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setPhotoUploading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const formatCountdown = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#05070a] text-slate-200 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#05070a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">TravelTrack</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right mr-1">
              <p className="text-sm font-medium text-white">{profile?.full_name}</p>
              <p className="text-xs text-slate-400">{profile?.assigned_area || 'No area assigned'}</p>
            </div>
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Offline Status Bar */}
      {!isOnline && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-between sticky top-[73px] z-10 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-red-400">
            <WifiOff size={14} />
            <span>Working Offline</span>
          </div>
          {queuedCount > 0 && (
            <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
              {queuedCount} IN QUEUE
            </span>
          )}
        </div>
      )}
      {syncing && (
        <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 flex items-center justify-between sticky top-[73px] z-10 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
            <CloudLightning size={14} className="animate-pulse" />
            <span>Syncing data...</span>
          </div>
          <span className="text-[10px] text-blue-400 font-bold">
            {queuedCount} REMAINING
          </span>
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* Alerts */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm flex gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-green-400 text-sm flex gap-2">
            <CheckCircle className="w-5 h-5 shrink-0" />
            {success}
          </div>
        )}

        {/* Active Session Card */}
        {activeSession ? (
          <div className="space-y-6">
            {!lastCheckinAt ? (
              /* Forced Initial Photo Prompt - INLINE */
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="saas-card p-8 border-orange-500/30 bg-orange-500/[0.03] text-center"
              >
                <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto mb-6">
                  <Camera className="w-8 h-8 text-orange-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Photo Proof Required</h3>
                <p className="text-slate-400 text-sm mb-8 max-w-xs mx-auto">
                  You must upload a photo to finalize your session start. This confirms your presence at the location.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoUploading}
                  className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-base shadow-xl shadow-orange-500/20"
                >
                  {photoUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera size={20} />}
                  {photoUploading ? 'Uploading proof...' : 'Capture & Upload Photo'}
                </button>
              </motion.div>
            ) : (
              <div className="saas-card p-6 border-orange-500/20 ring-1 ring-orange-500/10 shadow-[0_0_40px_-10px_rgba(249,115,22,0.1)]">
                <div className="flex items-center justify-between mb-8">
                  <h4 className="text-sm font-semibold text-white">Active Session</h4>
                  <div className="flex items-center gap-2">
                    <span className="status-dot active" />
                    <span className="text-green-400 text-xs font-semibold">Recording</span>
                  </div>
                </div>
                
                <div className="text-center py-6">
                  <p className="text-xs text-slate-400 font-medium mb-2 uppercase tracking-wide">Elapsed Time</p>
                  <p className="text-5xl font-light text-white tracking-tight">{elapsedTime}</p>
                </div>

                {nextCheckinIn !== null && (
                  <div className="bg-white/5 rounded-xl p-4 flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-300">Next photo check-in</span>
                    </div>
                    <span className="text-lg font-medium text-orange-400">{formatCountdown(nextCheckinIn)}</span>
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <button
                    id="manual-photo-btn"
                    onClick={() => setShowPhotoModal(true)}
                    className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-lg shadow-orange-500/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <Camera size={18} />
                    Add Field Photo
                  </button>
                  <button
                    id="end-session-btn"
                    onClick={endSession}
                    disabled={actionLoading}
                    className="w-full bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white py-3.5 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square size={16} fill="currentColor" />}
                    End Session
                  </button>
                </div>
              </div>
            )}

            {/* Current Session Photos */}
            {checkins.length > 0 && (
              <div className="saas-card p-6">
                <h4 className="text-sm font-semibold text-white mb-4">Photos Uploaded ({checkins.length})</h4>
                <div className="grid grid-cols-4 gap-3">
                  {checkins.map(c => (
                    <div key={c.id} className="aspect-square rounded-lg overflow-hidden border border-white/10">
                      <img src={c.photo_url} alt="checkin" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Start session card */
          <div className="saas-card p-10 text-center py-16">
            <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto mb-6">
              <MapPin className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Ready to start?</h2>
            <p className="text-slate-400 text-sm mb-8 max-w-xs mx-auto">
              Press Start to record your location and begin your field session.
            </p>
            <button
              id="start-session-btn"
              onClick={startSession}
              disabled={actionLoading}
              className="btn-primary w-full py-4 flex items-center justify-center gap-2 text-base"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play size={20} fill="currentColor" />}
              {actionLoading ? 'Getting location...' : 'Start Session'}
            </button>
            <p className="text-xs text-slate-500 mt-6">
              Your GPS location will be captured at start and end.
            </p>
          </div>
        )}

        {/* Past sessions */}
        {pastSessions.length > 0 && (
          <div className="space-y-4 pt-4">
            <h4 className="section-label">Past Sessions</h4>
            <div className="space-y-3">
              {pastSessions.map(session => (
                <div key={session.id} className="saas-card px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {format(new Date(session.start_time), 'MMM dd, yyyy')}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {format(new Date(session.start_time), 'hh:mm a')}
                        {session.end_time ? ` → ${format(new Date(session.end_time), 'hh:mm a')}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-slate-500 bg-white/5 px-2 py-1 rounded-md">
                    {formatDistanceToNow(new Date(session.start_time), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Photo Sync Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-[#05070a]/80 backdrop-blur-sm" onClick={() => setShowPhotoModal(false)}>
          <div className="saas-card p-8 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0">
                <Camera className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Photo Required</h3>
                <p className="text-slate-400 text-sm">Please take a photo to confirm your presence.</p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoUpload}
              className="hidden"
            />

            <button
              id="take-photo-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
              className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 text-sm mb-3"
            >
              {photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera size={16} />}
              {photoUploading ? 'Uploading...' : 'Take Photo'}
            </button>

            <button
              id="dismiss-modal-btn"
              onClick={() => setShowPhotoModal(false)}
              className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors"
            >
              Remind me later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
