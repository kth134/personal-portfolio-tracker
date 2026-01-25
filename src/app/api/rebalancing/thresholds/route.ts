import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, upside_threshold, downside_threshold, band_mode } = await request.json()

    if (typeof upside_threshold !== 'number' || typeof downside_threshold !== 'number' ||
        upside_threshold < 0 || downside_threshold < 0) {
      return NextResponse.json({ error: 'Invalid thresholds' }, { status: 400 })
    }

    // Check if sub-portfolio belongs to user
    const { data: subPortfolio } = await supabase
      .from('sub_portfolios')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!subPortfolio) {
      return NextResponse.json({ error: 'Sub-portfolio not found' }, { status: 404 })
    }

    // Update thresholds
    const { error } = await supabase
      .from('sub_portfolios')
      .update({
        upside_threshold,
        downside_threshold,
        band_mode
      })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating thresholds:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}