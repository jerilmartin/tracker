export type UserRole = 'admin' | 'user'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  assigned_area: string | null
  team?: string | null
  phone: string | null
  created_at: string
}

export interface GeoLocation {
  lat: number
  lng: number
  accuracy: number
  address?: string
}

export interface Session {
  id: string
  user_id: string
  start_time: string
  end_time: string | null
  start_location: GeoLocation | null
  end_location: GeoLocation | null
  status: 'active' | 'ended'
  created_at: string
  profiles?: Profile
}

export interface PhotoCheckin {
  id: string
  session_id: string
  user_id: string
  photo_url: string
  location: GeoLocation | null
  captured_at: string
  profiles?: Profile
}
