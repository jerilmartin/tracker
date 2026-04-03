# FieldTracker

FieldTracker is a full-stack Next.js web application built for campaign administrators to monitor field workers in real-time. It uses Supabase as the backend for Authentication, PostgreSQL Database, Real-time updates, and File Storage.

## Features

- **Field Worker Dashboard (Mobile First)**
  - Real-time GPS location tracking.
  - "Start Session" / "End Session" flows to log bounds of a working shift.
  - Hourly photo check-in reminders.
  - Elapsed session timer.
- **Admin Dashboard**
  - Live overview of all workers.
  - Status indicators (Active or Offline).
  - Duration, session history, and map links for location coordinates.
  - Photo vault for viewing worker check-ins.
- **Clean Architecture**
  - Next.js 16 (App Router).
  - Tailwind CSS + CSS Variables for sleek glassmorphic UI.
  - Shadcn UI integration.

## Setup Instructions

### 1. Supabase Backend Setup

1. Create a project at [Supabase](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Open `supabase/schema.sql` from this codebase and run the entire script. This will:
   - Create `profiles`, `sessions`, and `photo_checkins` tables.
   - Set up Row Level Security (RLS) policies.
   - Create a `field-photos` public storage bucket.
4. Go to **Authentication > Providers > Email**, and you can optionally disable "Confirm email" to allow seamless login without checking an inbox.
5. Setup the Admin account:
   - Go to **Authentication > Add User**.
   - Create a user with `admin@fieldtracker.app` and a secure password.
   - After creation, copy that user's **UUID**.
   - Go to the **SQL Editor** and run the following command to make them an admin:
     ```sql
     INSERT INTO public.profiles (id, full_name, role)
     VALUES ('<THEIR_UUID>', 'Administrator', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = 'admin';
     ```
### 2. Configure Environment Variables

Create a `.env.local` file at the root of your project:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_ADMIN_EMAIL=admin@fieldtracker.app
ADMIN_PASSWORD=your_admin_password
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run the App

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`
3. Navigate to `http://localhost:3000`

### Additional Information

Ensure your Field Workers are granting "Location" access to their browser when they hit the "Start Session" button; otherwise, their start and end locations cannot be captured.
