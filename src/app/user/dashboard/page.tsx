'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { MapPin, Play, Square, Camera, Clock, LogOut, User, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import type { Profile, Session, GeoLocation, PhotoCheckin } from '@/lib/types'
import { formatDistanceToNow, format } from 'date-fns'

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

  const loadCheckins = useCallback(async (sessionId: string) => {
    const { data } = await supabase
      .from('photo_checkins')
      .select('*')
      .eq('session_id', sessionId)
      .order('captured_at', { ascending: false })
    if (data) setCheckins(data)
  }, [supabase])

  // Setup hourly checkin reminder
  const setupCheckinTimer = useCallback((sessionStartTime: string) => {
    if (checkinTimerRef.current) clearInterval(checkinTimerRef.current)

    const CHECKIN_INTERVAL = 60 * 60 * 1000 // 1 hour in ms

    const updateCountdown = () => {
      const start = new Date(sessionStartTime).getTime()
      const now = Date.now()
      const elapsed = now - start
      const nextCheckin = CHECKIN_INTERVAL - (elapsed % CHECKIN_INTERVAL)
      setNextCheckinIn(Math.floor(nextCheckin / 1000))

      // Show modal when it's time for a checkin
      if (nextCheckin <= 1000 && elapsed > 30000) {
        setShowPhotoModal(true)
      }
    }

    updateCountdown()
    checkinTimerRef.current = setInterval(updateCountdown, 1000)
  }, [])

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
      setupCheckinTimer(activeSession.start_time)
      setupElapsedTimer(activeSession.start_time)
      loadCheckins(activeSession.id)
    } else {
      if (checkinTimerRef.current) clearInterval(checkinTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      setElapsedTime('')
      setNextCheckinIn(null)
    }
  }, [activeSession, setupCheckinTimer, setupElapsedTimer, loadCheckins])

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
      setSuccess('Session started! Your location has been recorded.')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start session')
    } finally {
      setActionLoading(false)
    }
  }

  const endSession = async () => {
    if (!activeSession) return
    if (!confirm('Are you sure you want to end this session?')) return
    setActionLoading(true)
    setError('')
    try {
      const location = await getLocation()
      const { error: err } = await supabase.from('sessions').update({
        end_location: location,
        end_time: new Date().toISOString(),
        status: 'ended',
      }).eq('id', activeSession.id)
      if (err) throw err
      setActiveSession(null)
      setSuccess('Session ended. Great work today!')
      setTimeout(() => setSuccess(''), 3000)
      loadData()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to end session')
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
      const { error: uploadError } = await supabase.storage
        .from('field-photos')
        .upload(fileName, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('field-photos').getPublicUrl(fileName)

      let location: GeoLocation | null = null
      try { location = await getLocation() } catch { /* optional */ }

      const { error: checkinError } = await supabase.from('photo_checkins').insert({
        session_id: activeSession.id,
        user_id: user.id,
        photo_url: publicUrl,
        location,
      })
      if (checkinError) throw checkinError

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-400" />
            <span className="font-bold text-white">FieldTracker</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                <User className="w-4 h-4 text-blue-400" />
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-medium text-white leading-none">{profile?.full_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{profile?.assigned_area || 'No area assigned'}</p>
              </div>
            </div>
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Alerts */}
        {error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {success}
          </div>
        )}

        {/* Active Session Card */}
        {activeSession ? (
          <div className="bg-gradient-to-br from-green-600/20 to-emerald-600/10 border border-green-500/30 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="status-dot active" />
                <span className="text-green-400 font-semibold text-sm">Session Active</span>
              </div>
              <span className="text-xs text-slate-400">
                {format(new Date(activeSession.start_time), 'dd MMM, hh:mm a')}
              </span>
            </div>

            {/* Elapsed time */}
            <div className="text-center py-4">
              <p className="text-xs text-slate-400 mb-1">ELAPSED TIME</p>
              <p className="text-4xl font-mono font-bold text-white tracking-wider">{elapsedTime}</p>
            </div>

            {/* Next checkin countdown */}
            {nextCheckinIn !== null && (
              <div className="mt-2 mb-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-300">Next photo check-in</p>
                  <p className="text-lg font-mono font-bold text-amber-400">{formatCountdown(nextCheckinIn)}</p>
                </div>
              </div>
            )}

            {/* Check-ins done */}
            {checkins.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-2">{checkins.length} check-in{checkins.length !== 1 ? 's' : ''} submitted</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {checkins.map(c => (
                    <a key={c.id} href={c.photo_url} target="_blank" rel="noreferrer"
                      className="shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-white/10 block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.photo_url} alt="checkin" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                id="upload-photo-btn"
                onClick={() => setShowPhotoModal(true)}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all"
              >
                <Camera className="w-4 h-4" />
                Upload Photo
              </button>
              <button
                id="end-session-btn"
                onClick={endSession}
                disabled={actionLoading}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium transition-all disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                End Session
              </button>
            </div>
          </div>
        ) : (
          /* Start session card */
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-blue-600/10 border-2 border-blue-500/30 flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-9 h-9 text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">Ready to start?</h2>
            <p className="text-slate-400 text-sm mb-6">
              Press Start to record your location and begin your field session.
            </p>
            <button
              id="start-session-btn"
              onClick={startSession}
              disabled={actionLoading}
              className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/30 disabled:opacity-60 text-sm"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {actionLoading ? 'Getting location...' : 'Start Session'}
            </button>
            <p className="text-xs text-slate-500 mt-3">Your GPS location will be captured at start and end</p>
          </div>
        )}

        {/* Past sessions */}
        {pastSessions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Past Sessions</h3>
            <div className="space-y-2">
              {pastSessions.map(session => (
                <div key={session.id} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="status-dot ended" />
                      <span className="text-sm font-medium text-white">
                        {format(new Date(session.start_time), 'dd MMM yyyy')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {format(new Date(session.start_time), 'hh:mm a')}
                      {session.end_time ? ` → ${format(new Date(session.end_time), 'hh:mm a')}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">
                      {formatDistanceToNow(new Date(session.start_time), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Photo Modal / Notification */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <Camera className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">Photo Check-in Required</h3>
                <p className="text-slate-400 text-xs">Take a photo to confirm your field presence</p>
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
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm transition-all mb-3"
            >
              {photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {photoUploading ? 'Uploading...' : 'Take / Choose Photo'}
            </button>

            <button
              id="dismiss-modal-btn"
              onClick={() => setShowPhotoModal(false)}
              className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white text-sm transition-colors"
            >
              Remind me later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
