-- ============================================================
--  FieldTracker — Supabase SQL Schema
--  Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  assigned_area TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  start_time       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  end_time         TIMESTAMPTZ,
  start_location   JSONB,   -- { lat, lng, accuracy }
  end_location     JSONB,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Photo check-ins table
CREATE TABLE IF NOT EXISTS public.photo_checkins (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  photo_url    TEXT NOT NULL,
  location     JSONB,
  captured_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_checkins ENABLE ROW LEVEL SECURITY;

-- Helper function to avoid infinite recursion when policies check the profiles table
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can read their own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- Allow checking if any admin exists for the login check
CREATE POLICY "Public can check admin status"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (role = 'admin');

-- Sessions
CREATE POLICY "Users can manage their own sessions"
  ON public.sessions FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all sessions"
  ON public.sessions FOR SELECT
  USING (public.is_admin());

-- Photo checkins
CREATE POLICY "Users can manage their own checkins"
  ON public.photo_checkins FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all checkins"
  ON public.photo_checkins FOR SELECT
  USING (public.is_admin());

-- ============================================================
-- Storage bucket for field photos
-- ============================================================
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: field-photos
-- Public: true (so photo URLs work without auth)

INSERT INTO storage.buckets (id, name, public)
VALUES ('field-photos', 'field-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: authenticated users can upload
CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'field-photos');

CREATE POLICY "Public read for field photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'field-photos');


-- ============================================================
-- Seed Admin Account (run AFTER you create the admin user
-- via Supabase Auth → Add User with admin@fieldtracker.app)
-- ============================================================
-- Replace <YOUR_ADMIN_USER_UUID> with the actual UUID from Auth → Users
--
-- INSERT INTO public.profiles (id, full_name, role)
-- VALUES ('<YOUR_ADMIN_USER_UUID>', 'Administrator', 'admin')
-- ON CONFLICT (id) DO UPDATE SET role = 'admin';
