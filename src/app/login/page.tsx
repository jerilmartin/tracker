'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MapPin, Eye, EyeOff, Loader2, Shield, User, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'user' | 'admin'>('user')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const loginEmail = username.includes('@') ? username : `${username}@fieldtracker.local`

    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email: loginEmail, password })



    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (mode === 'admin') {
        if (!profile || profile?.role !== 'admin') {
          // Fallback: If this is the official admin email, automatically grant admin profile
          if (data.user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
            const { error: upsertErr } = await supabase.from('profiles').upsert({
              id: data.user.id,
              full_name: 'Administrator',
              role: 'admin'
            })
            if (upsertErr) {
              await supabase.auth.signOut()
              setError(`Profile heal failed: ${upsertErr.message}`)
              setLoading(false)
              return
            }
            // Force a hard refresh to bypass caching issues
            window.location.href = '/admin/dashboard'
            return
          }

          await supabase.auth.signOut()
          setError('Access denied. No admin profile found for this account.')
          setLoading(false)
          return
        }
      }

      if (profile?.role === 'admin') {
        router.push('/admin/dashboard')
      } else {
        router.push('/user/dashboard')
      }
    }
  }

  return (
    <div className="bg-[#05070a] flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 mb-4">
            <MapPin className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">TravelTrack</h1>
          <p className="text-slate-400 mt-1 text-sm">Team tracking platform</p>
        </div>

        {/* Login box */}
        <div className="saas-card relative overflow-hidden">
          {/* Mode Tabs */}
          <div className="flex border-b border-white/5 bg-white/[0.02]">
            <button
              onClick={() => { setMode('user'); setError('') }}
              className={`flex-1 py-4 text-sm font-medium transition-all ${
                mode === 'user' ? 'text-orange-500 border-b-2 border-orange-500 bg-white/[0.02]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Field Worker
            </button>
            <button
              onClick={() => { setMode('admin'); setError('') }}
              className={`flex-1 py-4 text-sm font-medium transition-all ${
                mode === 'admin' ? 'text-orange-500 border-b-2 border-orange-500 bg-white/[0.02]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Admin Access
            </button>
          </div>

          <div className="p-8">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-red-400 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  placeholder={mode === 'admin' ? 'admin_id' : 'worker_id'}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="Enter your password"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                id="login-submit"
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3.5 mt-2 flex items-center justify-center gap-2 text-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
