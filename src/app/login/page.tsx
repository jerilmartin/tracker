'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MapPin, Eye, EyeOff, Loader2, Shield, User } from 'lucide-react'

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
    <div className="auth-bg flex items-center justify-center min-h-screen p-4">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 mb-4">
            <MapPin className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">FieldTracker</h1>
          <p className="text-slate-400 mt-1 text-sm">Campaign worker monitoring platform</p>
        </div>

        {/* Role toggle */}
        <div className="glass-card rounded-2xl p-1 flex mb-6">
          <button
            onClick={() => { setMode('user'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${mode === 'user'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-slate-400 hover:text-white'
              }`}
          >
            <User className="w-4 h-4" />
            Field Worker
          </button>
          <button
            onClick={() => { setMode('admin'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${mode === 'admin'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-slate-400 hover:text-white'
              }`}
          >
            <Shield className="w-4 h-4" />
            Administrator
          </button>
        </div>

        {/* Login card */}
        <div className="glass-card rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">
            {mode === 'admin' ? 'Admin Sign In' : 'Worker Sign In'}
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
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
                placeholder={mode === 'admin' ? 'admin@fieldtracker.app' : 'johndoe'}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
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
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/30 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>


        </div>
      </div>
    </div>
  )
}
