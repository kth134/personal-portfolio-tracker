'use client'

import { useState } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const { error } = isSignUp
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password })

    if (error) setError(error.message)
    else router.push('/dashboard')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-80">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-red-500">{error}</p>}
      <Button type="submit" className="w-full">{isSignUp ? 'Sign Up' : 'Log In'}</Button>
      <Button type="button" variant="secondary" onClick={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? 'Already have account? Log In' : 'Need account? Sign Up'}
      </Button>
    </form>
  )
}