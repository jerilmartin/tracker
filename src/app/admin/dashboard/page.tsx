'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  MapPin, Users, Activity, LogOut, Clock, Camera,
  ChevronDown, ChevronUp, RefreshCw, Shield, CheckCircle,
  AlertCircle, Loader2, Phone, Navigation, Image as ImageIcon, UserPlus,
  Search, Filter, Download, FileSpreadsheet, Check, Calendar,
  UserCheck, UserMinus, History
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { createWorker, deleteWorker } from '@/app/actions/admin'
import type { Profile, Session, PhotoCheckin } from '@/lib/types'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import { getAddressFromCoords } from '@/lib/utils/geocoding'

interface UserWithSession extends Profile {
  sessions: Array<Session & { photo_checkins: PhotoCheckin[] }>
}

type TabType = 'active' | 'absent' | 'date' | 'workers'

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
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [exportLoading, setExportLoading] = useState(false)

  // Handle history for photo modal (fix for swiping back on mobile)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (selectedPhoto) {
        setSelectedPhoto(null)
      }
    }
    if (selectedPhoto) {
      window.history.pushState({ modal: 'photo' }, '')
      window.addEventListener('popstate', handlePopState)
    }
    return () => window.removeEventListener('popstate', handlePopState)
  }, [selectedPhoto])

  const [searchQuery, setSearchQuery] = useState('')
  const [areaFilter, setAreaFilter] = useState<string[]>([])
  const [isAreaDropdownOpen, setIsAreaDropdownOpen] = useState(false)

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

  const getMissedCheckins = (user: UserWithSession) => {
    const active = user.sessions.find(s => s.status === 'active')
    if (!active) return 0
    const elapsedMinutes = differenceInMinutes(new Date(), new Date(active.start_time))
    const expected = Math.floor(elapsedMinutes / 60)
    const actual = active.photo_checkins.length
    return Math.max(0, expected - actual)
  }

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

  // Derive stats and filtered lists
  const activeUsers = users.filter(u => u.sessions.some(s => s.status === 'active'))
  const totalSessions = users.reduce((acc, u) => acc + u.sessions.length, 0)
  const totalCheckins = users.reduce((acc, u) => acc + u.sessions.reduce((sAcc, s) => sAcc + s.photo_checkins.length, 0), 0)

  const uniqueAreas = Array.from(new Set(users.map(u => u.assigned_area).filter(Boolean))).sort() as string[]

  const getTabUsers = () => {
    switch (activeTab) {
      case 'active':
        return users.filter(u => u.sessions.some(s => s.status === 'active'))
      case 'absent':
        return users.filter(u => !u.sessions.some(s => s.status === 'active'))
      case 'date':
        return users // Show all users, label them by activity on that date
      default:
        return users
    }
  }

  const tabUsers = getTabUsers()

  const displayedUsers = tabUsers.filter(user => {
    const matchesSearch = user.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesArea = areaFilter.length === 0 || (user.assigned_area && areaFilter.includes(user.assigned_area))

    // In "date" mode, we might want to filter only those who worked? 
    // Or users might want to see everyone to find the inactive ones.
    // The user said "understand who and all were active on that day and who were inactive".
    // So we show all, but maybe provide an internal toggle? 
    // For now, show all filtered by search/area.
    return matchesSearch && matchesArea
  })

  const handleCreateWorker = async (formData: FormData) => {
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    const res = await createWorker(formData)
    if (res.success) {
      setActionSuccess('Worker created successfully!')
      const form = document.getElementById('create-worker-form') as HTMLFormElement
      if (form) form.reset()
      loadData()
    } else {
      setActionError(res.error || 'Failed to create worker')
    }
    setActionLoading(false)
  }

  const handleDeleteWorker = async (userId: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently delete the account for ${name}? This cannot be undone.`)) return
    setActionLoading(true)
    setActionError('')
    setActionSuccess('')
    const res = await deleteWorker(userId)
    if (res.success) {
      setActionSuccess(`Account for ${name} deleted successfully.`)
      loadData()
    } else {
      setActionError(res.error || 'Failed to delete worker')
    }
    setActionLoading(false)
  }

  const handleExportExcel = async () => {
    setExportLoading(true)
    const dataToExport: any[] = []

    // Process sequentially to avoid Nominatim rate limiting (1 request/sec)
    for (const user of displayedUsers) {
      // Find the relevant session based on tab
      const session = activeTab === 'date'
        ? user.sessions.find(s => format(new Date(s.start_time), 'yyyy-MM-dd') === selectedDate)
        : user.sessions[0]

      if (!session) {
        dataToExport.push({
          'Worker Name': user.full_name,
          'Ondriyam': user.assigned_area || 'Unassigned',
          'Status': 'No Activity',
          'Start Time': '-',
          'End Time': '-',
          'Duration': '-',
          'Start Coords': '-',
          'Start Address': '-',
          'End Coords': '-',
          'End Address': '-',
          'Photos Uploaded': 0
        })
      } else {
        const start = new Date(session.start_time)
        const isOngoing = session.status === 'active'
        const end = isOngoing ? new Date() : (session.end_time ? new Date(session.end_time) : new Date(session.start_time))

        const durationMin = differenceInMinutes(end, start)
        const durationStr = `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`

        // START LOCATION PROCESSING
        let startAddress = '-'
        if (session.start_location) {
          startAddress = await getAddressFromCoords(session.start_location.lat, session.start_location.lng)
          if (displayedUsers.length > 2) await new Promise(r => setTimeout(r, 800))
        }

        // END LOCATION PROCESSING
        let endAddress = '-'
        let endCoords = '-'
        if (isOngoing) {
          endCoords = 'In Progress'
          endAddress = 'In Progress'
        } else if (session.end_location) {
          endCoords = `${session.end_location.lat}, ${session.end_location.lng}`
          endAddress = await getAddressFromCoords(session.end_location.lat, session.end_location.lng)
          if (displayedUsers.length > 2) await new Promise(r => setTimeout(r, 800))
        } else {
          // No end location captured (likely auto-logout)
          endCoords = 'Unknown'
          endAddress = 'Unknown'
        }

        dataToExport.push({
          'Worker Name': user.full_name,
          'Ondriyam': user.assigned_area || 'Unassigned',
          'Status': session.status.toUpperCase(),
          'Start Time': format(start, 'hh:mm a'),
          'End Time': isOngoing ? 'Ongoing' : (session.end_time ? format(new Date(session.end_time), 'hh:mm a') : '-'),
          'Duration': durationStr,
          'Start Coords': session.start_location ? `${session.start_location.lat}, ${session.start_location.lng}` : '-',
          'Start Address': startAddress,
          'End Coords': endCoords,
          'End Address': endAddress,
          'Photos Uploaded': session.photo_checkins?.length || 0
        })
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Session Report")

    const fileNameDate = activeTab === 'date' ? selectedDate : format(new Date(), 'yyyy-MM-dd')
    XLSX.writeFile(workbook, `TravelTrack_Report_${fileNameDate}.xlsx`)
    setExportLoading(false)
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
              <p className="text-sm font-medium text-white">{adminProfile?.full_name || 'Administrator'}</p>
            </div>
            <button
              id="export-excel-btn"
              onClick={handleExportExcel}
              disabled={exportLoading}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 transition-colors flex items-center gap-2 group disabled:opacity-50"
              title="Export to Excel"
            >
              {exportLoading ? (
                <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
              )}
              <span className="text-xs font-medium hidden md:inline">
                {exportLoading ? 'Processing...' : 'Export Excel'}
              </span>
            </button>
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
        <div className="flex flex-wrap gap-2 border-b border-white/5 pb-px mb-6">
          {[
            { key: 'active', label: 'Active', icon: <UserCheck size={14} className="mr-2" /> },
            { key: 'absent', label: 'Absent', icon: <UserMinus size={14} className="mr-2" /> },
            { key: 'date', label: 'By Date', icon: <Calendar size={14} className="mr-2" /> },
            { key: 'workers', label: 'Manage Workers', icon: <Users size={14} className="mr-2" /> },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabType)}
              className="relative px-6 py-4 text-sm font-medium transition-colors flex items-center"
            >
              <span className={`flex items-center ${activeTab === tab.key ? 'text-orange-500' : 'text-slate-400'}`}>
                {tab.icon}
                {tab.label}
              </span>
              {activeTab === tab.key && (
                <motion.div
                  layoutId="activeTabUnderline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Date Selector for 'date' tab */}
        {activeTab === 'date' && (
          <div className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl mb-6 flex flex-col sm:flex-row items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
                <Calendar className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Target Date Intelligence</h3>
                <p className="text-xs text-slate-500">Analyze worker deployment for a specific day</p>
              </div>
            </div>
            <div className="flex-1 w-full sm:w-auto">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full sm:w-64 bg-[#0a0c10] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500/50 transition-all cursor-pointer"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="flex gap-4 text-xs font-bold uppercase tracking-widest text-slate-500">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" /> Worked
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-700" /> No Activity
              </div>
            </div>
          </div>
        )}

        {/* Search & Filter Bar */}
        {activeTab !== 'workers' && (
          <div className="flex flex-col sm:flex-row gap-4 bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search by worker name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-all"
              />
            </div>
            <div className="relative min-w-[240px]">
              <div
                onClick={() => setIsAreaDropdownOpen(!isAreaDropdownOpen)}
                className="w-full bg-[#0a0c10] border border-white/10 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white cursor-pointer hover:border-white/20 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <span className="truncate">
                    {areaFilter.length === 0
                      ? 'All Assigned Areas'
                      : `${areaFilter.length} Area${areaFilter.length > 1 ? 's' : ''} Selected`}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isAreaDropdownOpen ? 'rotate-180' : ''}`} />
              </div>

              {isAreaDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setIsAreaDropdownOpen(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-2 z-40 bg-[#0a0c10] border border-white/10 rounded-xl shadow-2xl max-h-[300px] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10">
                    <button
                      onClick={() => {
                        setAreaFilter([])
                        setIsAreaDropdownOpen(false)
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-bold text-orange-500 hover:bg-white/5 rounded-lg mb-1"
                    >
                      CLEAR ALL FILTERS
                    </button>
                    {uniqueAreas.map(area => (
                      <label
                        key={area}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${areaFilter.includes(area) ? 'bg-orange-500 border-orange-500' : 'border-white/20 group-hover:border-white/40'}`}>
                          {areaFilter.includes(area) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={areaFilter.includes(area)}
                          onChange={() => {
                            setAreaFilter(prev =>
                              prev.includes(area)
                                ? prev.filter(a => a !== area)
                                : [...prev, area]
                            )
                          }}
                        />
                        <span className="text-sm text-slate-200 truncate">{area}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="space-y-4">
          {activeTab === 'workers' ? (
            <div className="space-y-8">
              {/* Form Card */}
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
                      <input name="username" type="text" required placeholder="username" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 text-sm" />
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

              {/* Worker Management List */}
              <div className="max-w-4xl mx-auto space-y-4">
                <h4 className="section-label">Existing Worker Accounts ({users.length})</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {users.map(u => (
                    <div key={u.id} className="saas-card bg-white/[0.01] p-4 flex items-center justify-between border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-bold text-slate-300">
                          {u.full_name.substring(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{u.full_name}</p>
                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{u.assigned_area || 'Unassigned'}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteWorker(u.id, u.full_name)}
                        className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all group"
                        title="Delete User"
                      >
                        <LogOut className="w-4 h-4 rotate-180" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : displayedUsers.length === 0 ? (
            <div className="text-center py-24 saas-card">
              <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-sm font-medium">
                {searchQuery || areaFilter.length > 0 ? 'No workers match your search criteria.' : 'No workers found in this category.'}
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
                  targetDate={activeTab === 'date' ? selectedDate : undefined}
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

function UserCard({ user, isExpanded, onToggle, onPhotoClick, targetDate }: {
  user: UserWithSession
  isExpanded: boolean
  onToggle: () => void
  onPhotoClick: (url: string) => void
  targetDate?: string // yyyy-MM-dd
}) {
  const activeSessionForDisplay = targetDate
    ? user.sessions.find(s => format(new Date(s.start_time), 'yyyy-MM-dd') === targetDate)
    : user.sessions.find(s => s.status === 'active')

  const activeSession = user.sessions.find(s => s.status === 'active') // For live indicators
  const allCheckins = user.sessions.flatMap(s => s.photo_checkins)
  const sessionDuration = activeSessionForDisplay ? (() => {
    const start = new Date(activeSessionForDisplay.start_time)
    const end = (activeSessionForDisplay.status === 'active' && (!targetDate || targetDate === format(new Date(), 'yyyy-MM-dd')))
      ? new Date()
      : (activeSessionForDisplay.end_time ? new Date(activeSessionForDisplay.end_time) : new Date(activeSessionForDisplay.start_time))
    return differenceInMinutes(end, start)
  })() : null

  // Compliance Logic: 1 photo required immediately, then 1 every 60m with 20m grace period.
  const missedCount = (() => {
    if (!activeSession) return 0
    const minutes = differenceInMinutes(new Date(), new Date(activeSession.start_time))

    // Initial Photo (due at T+0, violation at T+20)
    if (allCheckins.length === 0) {
      return minutes > 20 ? 1 : 0
    }

    // Subsequent Photos
    // A photo is "due" every 60 mins. Late if > 80 mins since last one or start.
    const expectedFromDuration = Math.floor(minutes / 60) + 1
    const actual = activeSession.photo_checkins.length

    // If we've passed the (expected * 60 + 20) threshold without the photo, it's missed.
    const isLateForNext = minutes > (actual * 60 + 20)
    return isLateForNext ? (expectedFromDuration - actual) : Math.max(0, expectedFromDuration - 1 - actual)
  })()

  return (
    <div className={`saas-card transition-all duration-300 ${isExpanded ? 'border-orange-500/40 ring-1 ring-orange-500/20 shadow-xl shadow-orange-500/5 bg-white/[0.03]' : 'hover:border-white/20'}`}>
      <button
        onClick={onToggle}
        className="w-full text-left p-5 flex items-center gap-5 transition-colors hover:bg-white/[0.01]"
      >
        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-transform ${isExpanded ? 'scale-110' : ''} ${activeSessionForDisplay ? 'bg-orange-500/20 text-orange-500 border border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.1)]' : 'bg-white/5 text-slate-500 border border-white/5 opacity-60'}`}>
          {user.full_name.substring(0, 1).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <p className={`font-semibold text-base tracking-tight ${activeSessionForDisplay ? 'text-white' : 'text-slate-400'}`}>{user.full_name}</p>
            {activeSessionForDisplay && (
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold ${activeSessionForDisplay.status === 'active' ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-orange-400 bg-orange-500/10 border-orange-500/20'} px-2 py-0.5 rounded-full border uppercase tracking-wider`}>
                  {activeSessionForDisplay.status === 'active' ? 'ACTIVE' : 'WORKED'}
                </span>
                {/* MISSED badges removed */}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-400">
            {user.assigned_area && <span className="flex items-center gap-1.5"><Navigation size={12} className="text-slate-500" /> {user.assigned_area}</span>}
            {user.phone && <span className="flex items-center gap-1.5"><Phone size={12} className="text-slate-500" /> {user.phone}</span>}
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end shrink-0 mr-2">
          {activeSessionForDisplay ? (
            <div className="text-right">
              <p className="text-orange-400 font-bold text-sm leading-none mb-1">
                {sessionDuration !== null ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : '0h 0m'}
              </p>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">DURATION</p>
            </div>
          ) : (
            <div className="text-right">
              <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">Absent</p>
            </div>
          )}
        </div>

        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="p-2 rounded-lg bg-white/5 text-slate-500"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            className="overflow-hidden"
          >
            <div className="p-6 pt-0 border-t border-white/5 bg-white/[0.01] space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
                {/* Current Section Details */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Session Intelligence</h4>
                    {missedCount > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 animate-pulse uppercase">
                        <AlertCircle size={12} /> Compliance Alert
                      </span>
                    )}
                  </div>

                  {activeSessionForDisplay ? (
                    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-4 shadow-inner">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400 font-medium">Session Start</span>
                        <span className="text-sm font-bold text-white">{format(new Date(activeSessionForDisplay.start_time), 'hh:mm a')}</span>
                      </div>

                      {activeSessionForDisplay.end_time && (
                        <div className="flex justify-between items-center border-t border-white/5 pt-4">
                          <span className="text-xs text-slate-400 font-medium">Session End</span>
                          <span className="text-sm font-bold text-white">{format(new Date(activeSessionForDisplay.end_time), 'hh:mm a')}</span>
                        </div>
                      )}

                      <div className="flex justify-between items-center border-t border-white/5 pt-4">
                        <span className="text-xs text-slate-400 font-medium">Compliance Pulse</span>
                        <div className="text-right">
                          <span className={`text-xs font-black px-2 py-1 rounded-md leading-none inline-block ${missedCount === 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-500'}`}>
                            {missedCount === 0 ? 'COMPLIANT' : 'VIOLATION'}
                          </span>
                        </div>
                      </div>

                      {activeSessionForDisplay.start_location && (
                        <div className="flex justify-between items-center border-t border-white/5 pt-4">
                          <span className="text-xs text-slate-400 font-medium">Capture Location</span>
                          <a
                            href={`https://maps.google.com/?q=${activeSessionForDisplay.start_location.lat},${activeSessionForDisplay.start_location.lng}`}
                            target="_blank" rel="noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 transition-colors"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            MAP VIEW →
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white/[0.02] border border-dashed border-white/10 rounded-2xl p-8 text-center">
                      <p className="text-sm text-slate-500 font-medium">No activity for this period.</p>
                    </div>
                  )}
                </div>

                {/* Live Photo Stream (Targeted to the session on that date) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Day Captures</h4>
                    <span className="text-[10px] font-bold text-slate-400">
                      {activeSessionForDisplay?.photo_checkins.length || 0} Photos
                    </span>
                  </div>

                  {!activeSessionForDisplay || activeSessionForDisplay.photo_checkins.length === 0 ? (
                    <div className="bg-white/[0.02] border border-dashed border-white/10 rounded-2xl p-10 text-center">
                      <ImageIcon className="w-8 h-8 text-slate-700 mx-auto mb-3 opacity-30" />
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wide">None Found</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {activeSessionForDisplay.photo_checkins.map(photo => (
                        <motion.button
                          key={photo.id}
                          whileHover={{ scale: 1.05, y: -2 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => onPhotoClick(photo.photo_url)}
                          className="aspect-square relative rounded-xl overflow-hidden border border-white/10 shadow-lg group"
                        >
                          <img src={photo.photo_url} alt="checkin" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute bottom-1.5 inset-x-1.5 flex items-center justify-center">
                            <span className="text-[8px] text-white font-black bg-black/40 backdrop-blur-md px-1.5 py-0.5 rounded shadow-sm">
                              {format(new Date(photo.captured_at), 'hh:mm a')}
                            </span>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
