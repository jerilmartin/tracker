'use server'

import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createWorker(formData: FormData) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() {}, // Read-only for backend action
        },
      }
    )

    // 1. Validate Admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')
    
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') throw new Error('Not authorized')

    // 2. Validate Service Role
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
       throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to create new workers.")
    }

    const adminAuthClient = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // 3. Extract inputs
    const username = formData.get('username') as string
    const password = formData.get('password') as string
    const phone = formData.get('phone') as string
    const assignedArea = formData.get('assignedArea') as string
    
    if (!username || !password) {
      throw new Error("Username and Password are required.")
    }

    const cleanUsername = username.trim().replace(/\s+/g, '.')
    const dummyEmail = cleanUsername.includes('@') ? cleanUsername : `${cleanUsername}@fieldtracker.local`

    // 4. Create User explicitly overriding the confirmation logic
    const { data: newUser, error } = await adminAuthClient.auth.admin.createUser({
      email: dummyEmail,
      password: password,
      email_confirm: true,
      user_metadata: { full_name: username }
    })

    if (error) throw new Error(error.message)

    // 5. Build Profile
    const { error: profileError } = await adminAuthClient.from('profiles').insert({
      id: newUser.user.id,
      full_name: username,
      role: 'user',
      phone: phone || null,
      assigned_area: assignedArea || null
    })

    if (profileError) {
      await adminAuthClient.auth.admin.deleteUser(newUser.user.id)
      throw new Error(profileError.message)
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create worker' }
  }
}
