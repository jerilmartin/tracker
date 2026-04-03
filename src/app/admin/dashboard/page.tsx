'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  MapPin, Users, Activity, LogOut, Clock, Camera,
  ChevronDown, ChevronUp, RefreshCw, Shield, CheckCircle,
  AlertCircle, Loader2, Phone, Navigation, Image as ImageIcon, UserPlus
} from 'lucide-react'
import { createWorker } from '@/app/actions/admin'
import type { Profile, Session, PhotoCheckin } from '@/lib/types'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'

interface UserWithSession extends Profile {
  sessions: Array<Session & { photo_checkins: PhotoCheckin[] }>
}

type TabType = 'active' | 'all' | 'workers'

export default function AdminDashboard() {
  const router = useRouter()
  const supabase = createClient()

  const [adminProfile, setAdminProfile] = useState<Profile | null>(null)
  const [users, setUsers] = useState<UserWithSession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('active')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof, error: profErr } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (prof?.role !== 'admin') { 
      setAdminProfile({ full_name: `ERROR: Role is ${prof?.role || 'null'}. Error: ${profErr?.message || 'none'}` } as any)
      return 
    }
    setAdminProfile(prof)

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'user')
      .order('full_name')

    const { data: sessions } = await supabase
      .from('sessions')
      .select('*, photo_checkins(*)')
      .order('created_at', { ascending: false })

    const { data: checkins } = await supabase
      .from('photo_checkins')
      .select('*')
      .order('captured_at', { ascending: false })

    if (profiles) {
      const usersWithSessions: UserWithSession[] = profiles.map(p => ({
        ...p,
        sessions: (sessions || [])
          .filter(s => s.user_id === p.id)
          .map(s => ({
            ...s,
            photo_checkins: (checkins || []).filter(c => c.session_id === s.id)
          }))
      }))
      setUsers(usersWithSessions)
    }
  }, [supabase, router])

  useEffect(() => {
    setLoading(true)
    loadData().finally(() => setLoading(false))

    // Realtime subscription
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photo_checkins' }, () => loadData())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [loadData, supabase])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleCreateWorker = async (formData: FormData) => {
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    const res = await createWorker(formData)
    if (res.success) {
      setActionSuccess('Worker created successfully!')
      // reset form
      const form = document.getElementById('create-worker-form') as HTMLFormElement
      if (form) form.reset()
      loadData()
    } else {
      setActionError(res.error || 'Failed to create worker')
    }
    setActionLoading(false)
  }

  // Stats
  const activeUsers = users.filter(u => u.sessions.some(s => s.status === 'active'))
  const totalSessions = users.reduce((sum, u) => sum + u.sessions.length, 0)
  const totalCheckins = users.reduce((sum, u) => sum + u.sessions.reduce((s2, s) => s2 + s.photo_checkins.length, 0), 0)

  // Filter users for tabs
  const displayedUsers = activeTab === 'active'
    ? users.filter(u => u.sessions.some(s => s.status === 'active'))
    : users

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
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <span className="font-bold text-white">FieldTracker</span>
              <span className="ml-2 text-xs bg-blue-600/20 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded-full">Admin</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-slate-300 text-sm mr-2">
              <Shield className="w-4 h-4 text-blue-400" />
              {adminProfile?.full_name || 'Administrator'}
            </div>
            <button
              id="refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              id="admin-logout-btn"
              onClick={handleLogout}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Users className="w-5 h-5 text-blue-400" />} label="Total Workers" value={users.length} color="blue" />
          <StatCard icon={<Activity className="w-5 h-5 text-green-400" />} label="Active Now" value={activeUsers.length} color="green" pulse={activeUsers.length > 0} />
          <StatCard icon={<Clock className="w-5 h-5 text-amber-400" />} label="Total Sessions" value={totalSessions} color="amber" />
          <StatCard icon={<Camera className="w-5 h-5 text-purple-400" />} label="Photo Check-ins" value={totalCheckins} color="purple" />
        </div>

        {/* Real-time status bar */}
        {activeUsers.length > 0 && (
          <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
            <span className="status-dot active" />
            <p className="text-green-400 text-sm font-medium">
              {activeUsers.length} worker{activeUsers.length !== 1 ? 's' : ''} currently active in the field
            </p>
            <span className="ml-auto text-xs text-green-500/70">Live dashboard • auto-updates</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-white/10 rounded-xl p-1">
          {([
            { key: 'active', label: `Active (${activeUsers.length})` },
            { key: 'all', label: `All Workers (${users.length})` },
            { key: 'workers', label: `Manage Workers` },
          ] as { key: TabType; label: string }[]).map(tab => (
            <button
              key={tab.key}
              id={`tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Users list */}
        <div className="space-y-3">
          {activeTab === 'workers' ? (
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Create New Worker</h3>
                  <p className="text-slate-400 text-sm">Add a new field worker account</p>
                </div>
              </div>

              {actionError && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {actionError}
                </div>
              )}
              {actionSuccess && (
                <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-5 text-green-400 text-sm">
                  <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {actionSuccess}
                </div>
              )}

              <form id="create-worker-form" action={handleCreateWorker} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Username *</label>
                    <input name="username" type="text" required placeholder="johndoe" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Password *</label>
                    <input name="password" type="text" required placeholder="Min. 6 characters" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Phone Number (Optional)</label>
                    <input name="phone" type="tel" placeholder="+1 234 567 8900" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Assigned Area</label>
                    <input name="assignedArea" type="text" placeholder="Village / Zone Map" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                </div>

                <div className="pt-2">
                  <button type="submit" disabled={actionLoading} className="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-all shadow-lg shadow-blue-600/30 disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2">
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    {actionLoading ? 'Creating Worker...' : 'Create Worker Account'}
                  </button>
                </div>
              </form>
            </div>
          ) : displayedUsers.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              {activeTab === 'active'
                ? 'No workers are currently active in the field.'
                : 'No workers found. Go to Manage Workers to add some.'}
            </div>
          ) : (
            displayedUsers.map(user => (
              <UserCard
                key={user.id}
                user={user}
                isExpanded={expandedUser === user.id}
                onToggle={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                onPhotoClick={setSelectedPhoto}
              />
            ))
          )}
        </div>
      </main>

      {/* Photo lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selectedPhoto} alt="Field checkin" className="w-full rounded-2xl shadow-2xl" />
            <button
              id="close-photo-btn"
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-3 right-3 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-all text-sm"
            >✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color, pulse }: {
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'green' | 'amber' | 'purple'
  pulse?: boolean
}) {
  const colorMap = {
    blue: 'bg-blue-600/10 border-blue-500/20',
    green: 'bg-green-600/10 border-green-500/20',
    amber: 'bg-amber-600/10 border-amber-500/20',
    purple: 'bg-purple-600/10 border-purple-500/20',
  }
  return (
    <div className={`${colorMap[color]} border rounded-xl p-4 ${pulse ? 'pulse-active' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}

function UserCard({ user, isExpanded, onToggle, onPhotoClick }: {
  user: UserWithSession
  isExpanded: boolean
  onToggle: () => void
  onPhotoClick: (url: string) => void
}) {
  const activeSession = user.sessions.find(s => s.status === 'active')
  const allCheckins = user.sessions.flatMap(s => s.photo_checkins)
  const latestSession = user.sessions[0]

  const sessionDuration = activeSession
    ? differenceInMinutes(new Date(), new Date(activeSession.start_time))
    : null

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
      {/* Card header — always visible */}
      <button
        id={`user-card-${user.id}`}
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-white/2 transition-colors"
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          {activeSession && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-slate-900 rounded-full" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-white text-sm">{user.full_name}</p>
            {activeSession && (
              <span className="text-xs bg-green-500/20 border border-green-500/30 text-green-400 px-2 py-0.5 rounded-full">
                ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
            {user.assigned_area && (
              <span className="flex items-center gap-1">
                <Navigation className="w-3 h-3" />
                {user.assigned_area}
              </span>
            )}
            {user.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {user.phone}
              </span>
            )}
          </div>
        </div>

        {/* Right side stats */}
        <div className="text-right shrink-0 hidden sm:block">
          {activeSession ? (
            <>
              <p className="text-green-400 font-semibold text-sm">
                {sessionDuration !== null ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : '—'}
              </p>
              <p className="text-xs text-slate-500">active</p>
            </>
          ) : latestSession ? (
            <>
              <p className="text-slate-300 text-sm">{user.sessions.length} session{user.sessions.length !== 1 ? 's' : ''}</p>
              <p className="text-xs text-slate-500">{formatDistanceToNow(new Date(latestSession.start_time), { addSuffix: true })}</p>
            </>
          ) : (
            <p className="text-xs text-slate-500">No sessions</p>
          )}
        </div>

        {/* Expand toggle */}
        <div className="text-slate-500 shrink-0 ml-2">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-white/10 px-5 py-4 space-y-4">
          {/* Active session details */}
          {activeSession && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-3">Current Session</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Started</p>
                  <p className="text-white font-medium">{format(new Date(activeSession.start_time), 'hh:mm a')}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Duration</p>
                  <p className="text-white font-medium">
                    {sessionDuration !== null ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : '—'}
                  </p>
                </div>
                {activeSession.start_location && (
                  <div className="col-span-2">
                    <p className="text-slate-500 text-xs mb-0.5">Start Location</p>
                    <a
                      href={`https://maps.google.com/?q=${activeSession.start_location.lat},${activeSession.start_location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      {activeSession.start_location.lat.toFixed(5)}, {activeSession.start_location.lng.toFixed(5)}
                      <span className="text-slate-500">→ Open in Maps</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Photo checkins */}
          {allCheckins.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                Photo Check-ins ({allCheckins.length})
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {allCheckins.map(c => (
                  <button
                    key={c.id}
                    id={`photo-${c.id}`}
                    onClick={() => onPhotoClick(c.photo_url)}
                    className="group relative aspect-square rounded-xl overflow-hidden border border-white/10 hover:border-blue-500/50 transition-all"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.photo_url} alt="checkin" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                      <p className="text-white text-[10px]">{format(new Date(c.captured_at), 'HH:mm')}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
              <ImageIcon className="w-4 h-4" />
              No photo check-ins yet
            </div>
          )}

          {/* Session history */}
          {user.sessions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Session History
              </p>
              <div className="space-y-2">
                {user.sessions.map(session => (
                  <div key={session.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-800/50 border border-white/5 text-sm">
                    <div className="flex items-center gap-3">
                      {session.status === 'active'
                        ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                        : <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
                      }
                      <div>
                        <p className="text-white text-xs font-medium">{format(new Date(session.start_time), 'dd MMM yyyy')}</p>
                        <p className="text-slate-500 text-xs">
                          {format(new Date(session.start_time), 'hh:mm a')}
                          {session.end_time ? ` → ${format(new Date(session.end_time), 'hh:mm a')}` : ' → ongoing'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        session.status === 'active'
                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                          : 'bg-slate-700 border-white/10 text-slate-400'
                      }`}>
                        {session.status === 'active' ? 'Active' : 'Ended'}
                      </span>
                      <p className="text-slate-500 text-xs mt-1">
                        {session.photo_checkins.length} photo{session.photo_checkins.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
