import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { asset_id, sub_portfolio_id, target_percentage } = await request.json()

    if (typeof target_percentage !== 'number' || target_percentage < 0 || target_percentage > 100) {
      return NextResponse.json({ error: 'Invalid target percentage' }, { status: 400 })
    }

    // Check if sub-portfolio belongs to user
    const { data: subPortfolio } = await supabase
      .from('sub_portfolios')
      .select('id')
      .eq('id', sub_portfolio_id)
      .eq('user_id', user.id)
      .single()

    if (!subPortfolio) {
      return NextResponse.json({ error: 'Sub-portfolio not found' }, { status: 404 })
    }

    // Check if asset exists and belongs to user
    const { data: asset } = await supabase
      .from('assets')
      .select('id')
      .eq('id', asset_id)
      .eq('user_id', user.id)
      .single()

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    // Upsert asset target
    const { error } = await supabase
      .from('asset_targets')
      .upsert({
        asset_id,
        sub_portfolio_id,
        target_percentage,
        user_id: user.id
      }, {
        onConflict: 'asset_id,sub_portfolio_id,user_id'
      })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating asset target:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}