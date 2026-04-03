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
      <div className="min-h-screen bg-[#05070a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#05070a] text-slate-200 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#05070a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">TravelTrack</h1>
              <p className="text-slate-400 text-xs">Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right mr-2">
              <p className="text-sm font-medium text-white">{adminProfile?.full_name || 'Admin User'}</p>
            </div>
            <button
              id="refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              id="admin-logout-btn"
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Workers" value={users.length} icon={<Users size={18} />} />
          <StatCard label="Active Now" value={activeUsers.length} icon={<Activity size={18} />} active={activeUsers.length > 0} />
          <StatCard label="Total Sessions" value={totalSessions} icon={<Clock size={18} />} />
          <StatCard label="Total Photos" value={totalCheckins} icon={<Camera size={18} />} />
        </div>

        {/* Tab Controls */}
        <div className="flex gap-2 border-b border-white/5 pb-px">
          {[
            { key: 'active', label: 'Active Workers' },
            { key: 'all', label: 'All Workers' },
            { key: 'workers', label: 'Manage Workers' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabType)}
              className={`px-5 py-3 text-sm font-medium transition-all rounded-t-lg ${
                activeTab === tab.key ? 'text-orange-500 bg-orange-500/10 border-b-2 border-orange-500' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="space-y-4">
          {activeTab === 'workers' ? (
            <div className="saas-card p-8 max-w-2xl mx-auto">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 border border-white/10 rounded-xl flex items-center justify-center bg-white/5">
                  <UserPlus className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Create Worker Account</h3>
                  <p className="text-slate-400 text-sm">Add a new user to the field team</p>
                </div>
              </div>
              
              {actionError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-red-400 text-sm flex gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {actionError}
                </div>
              )}
              {actionSuccess && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6 text-green-400 text-sm flex gap-2">
                  <CheckCircle className="w-5 h-5 shrink-0" />
                  {actionSuccess}
                </div>
              )}

              <form id="create-worker-form" action={handleCreateWorker} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Username *</label>
                    <input name="username" type="text" required placeholder="e.g. johndoe" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Password *</label>
                    <input name="password" type="text" required placeholder="Min 6 characters" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Phone Number (Optional)</label>
                    <input name="phone" type="tel" placeholder="+1234567890" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Assigned Area</label>
                    <input name="assignedArea" type="text" placeholder="Village / Zone / District" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm" />
                  </div>
                </div>

                <div className="pt-2">
                  <button type="submit" disabled={actionLoading} className="btn-primary px-8 py-3 w-full sm:w-auto flex items-center justify-center gap-2">
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={18} />}
                    {actionLoading ? 'Creating User...' : 'Create Worker'}
                  </button>
                </div>
              </form>
            </div>
          ) : displayedUsers.length === 0 ? (
            <div className="text-center py-24 saas-card">
              <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-sm font-medium">
                No workers currently active.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {displayedUsers.map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  isExpanded={expandedUser === user.id}
                  onToggle={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                  onPhotoClick={setSelectedPhoto}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Photo Lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-[#05070a]/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img src={selectedPhoto} alt="Field checkin" className="w-full rounded-2xl shadow-2xl" />
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute -top-12 right-0 text-white hover:text-orange-500 text-sm font-medium flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl transition-all"
            >
              Close <span className="text-lg leading-none">✕</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, active }: { label: string, value: number, icon: React.ReactNode, active?: boolean }) {
  return (
    <div className="saas-card p-6">
      <div className="flex items-center justify-between mb-4 text-slate-400">
        <span className="font-medium text-sm">{label}</span>
        <div className="bg-white/5 p-2 rounded-lg">{icon}</div>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-3xl font-bold text-white">{value}</p>
        {active && <span className="status-dot active ml-auto" />}
      </div>
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
  const sessionDuration = activeSession ? differenceInMinutes(new Date(), new Date(activeSession.start_time)) : null

  return (
    <div className={`saas-card transition-all duration-200 ${isExpanded ? 'border-orange-500/30 ring-1 ring-orange-500/30' : 'hover:border-white/20'}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-5 flex items-center gap-5"
      >
        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${activeSession ? 'bg-orange-500/20 text-orange-500 border border-orange-500/30' : 'bg-white/5 text-slate-300 border border-white/10'}`}>
          {user.full_name.substring(0, 1).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <p className="font-semibold text-white text-base">{user.full_name}</p>
            {activeSession && (
              <span className="text-xs font-semibold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
            {user.assigned_area && <span className="flex items-center gap-1.5"><Navigation size={14} /> {user.assigned_area}</span>}
            {user.phone && <span className="flex items-center gap-1.5"><Phone size={14} /> {user.phone}</span>}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end shrink-0">
          {activeSession ? (
            <>
              <p className="text-orange-400 font-semibold text-sm">
                {sessionDuration !== null ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : '0h 0m'}
              </p>
              <p className="text-xs text-slate-500">duration</p>
            </>
          ) : (
            <>
              <p className="text-slate-300 text-sm font-medium">{user.sessions.length} sessions</p>
              <p className="text-xs text-slate-500">total</p>
            </>
          )}
        </div>
        
        <div className="ml-4 text-slate-500">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-6 border-t border-white/5 bg-white/[0.02] rounded-b-2xl space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Current/Latest Data */}
            <div className="space-y-4">
              <h4 className="section-label">Current Session</h4>
              {activeSession ? (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-end">
                    <span className="text-sm text-slate-400">Started</span>
                    <span className="text-sm font-medium text-white">{format(new Date(activeSession.start_time), 'hh:mm a')}</span>
                  </div>
                  {activeSession.start_location && (
                    <div className="flex justify-between items-end border-t border-white/5 pt-3">
                      <span className="text-sm text-slate-400">Start Location</span>
                      <a
                        href={`https://maps.google.com/?q=${activeSession.start_location.lat},${activeSession.start_location.lng}`}
                        target="_blank" rel="noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        View on map →
                      </a>
                    </div>
                  )}
                </div>
              ) : latestSession ? (
                <p className="text-slate-400 text-sm">
                  Last active: {formatDistanceToNow(new Date(latestSession.start_time), { addSuffix: true })}
                </p>
              ) : (
                <p className="text-slate-500 text-sm">No sessions found</p>
              )}
            </div>

            {/* Photos */}
            <div className="space-y-4">
              <h4 className="section-label flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Photos ({allCheckins.length})
              </h4>
              {allCheckins.length > 0 ? (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                  {allCheckins.map(c => (
                    <div key={c.id} className="relative group">
                      <button
                        onClick={() => onPhotoClick(c.photo_url)}
                        className="aspect-square w-full rounded-lg  overflow-hidden hover:ring-2 hover:ring-orange-500 transition-all"
                      >
                        <img src={c.photo_url} alt="Field data" className="w-full h-full object-cover" />
                      </button>
                      <span className="absolute bottom-1 right-1 text-xs text-white bg-black/60 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        {format(new Date(c.captured_at), 'hh:mm')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-sm">No photos uploaded yet</p>
              )}
            </div>
          </div>

          {/* Detailed History Mapping */}
          {user.sessions.length > 0 && (
            <div className="space-y-4">
              <h4 className="section-label flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Session History
              </h4>
              <div className="space-y-2">
                {user.sessions.slice(0, 5).map(session => (
                  <div key={session.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      {session.status === 'active' ? (
                        <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                          <CheckCircle className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div>
                        <p className="text-white text-sm font-medium">{format(new Date(session.start_time), 'MMM dd, yyyy')}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {format(new Date(session.start_time), 'hh:mm a')} → {session.end_time ? format(new Date(session.end_time), 'hh:mm a') : 'Ongoing'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-slate-300">
                        {session.photo_checkins.length} photos
                      </p>
                      {session.status === 'active' && <span className="text-xs text-green-400">Active now</span>}
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
