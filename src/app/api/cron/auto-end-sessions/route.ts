import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    // Simple protection with a CRON_SECRET if it exists
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    try {
        // End all active sessions
        // We set end_time to the current time
        // This script should be called at 11:00 PM IST (17:30 UTC)
        const { data, error } = await supabase
            .from('sessions')
            .update({
                status: 'ended',
                end_time: new Date().toISOString(),
            })
            .eq('status', 'active')
            .select()

        if (error) throw error

        return NextResponse.json({
            success: true,
            message: `${data?.length || 0} sessions ended.`,
            sessions: data
        })
    } catch (error: any) {
        console.error('Auto-end sessions cron error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
