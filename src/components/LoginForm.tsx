'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'  // ← new import
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { IconBrandGoogle } from '@tabler/icons-react'  // optional

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()  // ← create here (or in useEffect if preferred)

  const handleSocialLogin = async () => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) setError(error.message)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else if (data.session) {
        router.push('/dashboard')
      } else {
        setError('Check email for confirmation link. Then log in.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/dashboard')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-80">
      {/* Email + Password inputs unchanged */}
      {error && <p className="text-red-500">{error}</p>}
      <Button type="submit" className="w-full">{isSignUp ? 'Sign Up' : 'Log In'}</Button>

      {/* Optional OR divider */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Or</span></div>
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={handleSocialLogin}>
        {IconBrandGoogle && <IconBrandGoogle className="mr-2 h-4 w-4" />}
        Login with Google
      </Button>

      <Button type="button" variant="secondary" onClick={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? 'Already have account? Log In' : 'Need account? Sign Up'}
      </Button>
    </form>
  )
}