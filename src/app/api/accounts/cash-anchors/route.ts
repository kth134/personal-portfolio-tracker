import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('account_id')

    let query = supabase
      .from('account_cash_anchors')
      .select('id, account_id, effective_date, balance, created_at, note')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (accountId) query = query.eq('account_id', accountId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ anchors: data || [] })
  } catch (error) {
    console.error('Cash anchors GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cash anchors.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { account_id, effective_date, balance, note } = await req.json()
    const numericBalance = Number(balance)
    const today = new Date().toISOString().slice(0, 10)

    if (!account_id) return NextResponse.json({ error: 'Account is required.' }, { status: 400 })
    if (!effective_date) return NextResponse.json({ error: 'Effective date is required.' }, { status: 400 })
    if (effective_date > today) return NextResponse.json({ error: 'Effective date cannot be in the future.' }, { status: 400 })
    if (!Number.isFinite(numericBalance)) return NextResponse.json({ error: 'Enter a valid cash balance.' }, { status: 400 })

    const { data, error } = await supabase
      .from('account_cash_anchors')
      .insert({
        account_id,
        effective_date,
        balance: numericBalance,
        note: note || null,
        created_by: user.id,
      })
      .select('id, account_id, effective_date, balance, created_at, note')
      .single()

    if (error) throw error

    return NextResponse.json({ anchor: data })
  } catch (error) {
    console.error('Cash anchors POST error:', error)
    return NextResponse.json({ error: 'Failed to save cash balance.' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Anchor id is required.' }, { status: 400 })

    const { error } = await supabase
      .from('account_cash_anchors')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Cash anchors DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove manual cash balance.' }, { status: 500 })
  }
}