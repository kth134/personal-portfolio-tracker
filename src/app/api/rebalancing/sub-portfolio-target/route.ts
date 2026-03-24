import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { id } = body
    const target_percentage = body.target_percentage ?? body.target_allocation
    const scaled = typeof target_percentage === 'number' ? target_percentage * 100 : NaN
    const hasTwoOrFewerDecimals = Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 1e-9

    if (typeof target_percentage !== 'number' || !Number.isFinite(target_percentage) || target_percentage < 0 || target_percentage > 100 || !hasTwoOrFewerDecimals) {
      return NextResponse.json({ error: 'Invalid target percentage' }, { status: 400 })
    }

    const normalizedTarget = Math.round(target_percentage * 100) / 100

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

    // Update target
    const { error } = await supabase
      .from('sub_portfolios')
      .update({ target_allocation: normalizedTarget })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating sub-portfolio target:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}