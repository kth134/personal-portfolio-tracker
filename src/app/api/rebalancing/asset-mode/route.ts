import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { asset_id, sub_portfolio_id, band_mode, target_percentage } = await request.json()

    if (!asset_id || !sub_portfolio_id || typeof band_mode !== 'boolean') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const { data: subPortfolio } = await supabase
      .from('sub_portfolios')
      .select('id')
      .eq('id', sub_portfolio_id)
      .eq('user_id', user.id)
      .single()

    if (!subPortfolio) {
      return NextResponse.json({ error: 'Sub-portfolio not found' }, { status: 404 })
    }

    const { data: asset } = await supabase
      .from('assets')
      .select('id')
      .eq('id', asset_id)
      .eq('user_id', user.id)
      .single()

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const { data: existingTarget } = await supabase
      .from('asset_targets')
      .select('target_percentage')
      .eq('asset_id', asset_id)
      .eq('sub_portfolio_id', sub_portfolio_id)
      .eq('user_id', user.id)
      .maybeSingle()

    const fallbackTarget = typeof target_percentage === 'number' && Number.isFinite(target_percentage)
      ? Math.round(target_percentage * 100) / 100
      : 0

    const upsertTarget = existingTarget?.target_percentage ?? fallbackTarget

    const primaryWrite = await supabase
      .from('asset_targets')
      .upsert(
        {
          asset_id,
          sub_portfolio_id,
          user_id: user.id,
          target_percentage: upsertTarget,
          band_mode_override: band_mode,
        },
        { onConflict: 'asset_id,sub_portfolio_id,user_id' }
      )

    let writeError = primaryWrite.error

    if (writeError && /band_mode_override/i.test(String(writeError.message || ''))) {
      const fallbackWrite = await supabase
        .from('asset_targets')
        .upsert(
          {
            asset_id,
            sub_portfolio_id,
            user_id: user.id,
            target_percentage: upsertTarget,
            band_mode,
          },
          { onConflict: 'asset_id,sub_portfolio_id,user_id' }
        )

      writeError = fallbackWrite.error
    }

    if (writeError) throw writeError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating asset mode override:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
