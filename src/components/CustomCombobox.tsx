'use client'

import { useState } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CustomComboboxProps {
  options: string[]
  placeholder: string
  value: string
  onChange: (value: string) => void
}

export function CustomCombobox({ options, placeholder, value, onChange }: CustomComboboxProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const handleSelect = (currentValue: string) => {
    onChange(currentValue === value ? '' : currentValue)
    setOpen(false)
    setInputValue('')
  }

  const handleCreate = () => {
    if (inputValue && !options.includes(inputValue)) {
      onChange(inputValue)
      setOpen(false)
      setInputValue('')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between">
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder={placeholder} value={inputValue} onValueChange={setInputValue} />
          <CommandList>
            <CommandEmpty>
              <CommandItem onSelect={handleCreate}>Create "{inputValue}"</CommandItem>
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} onSelect={() => handleSelect(option)}>
                  <Check className={cn("mr-2 h-4 w-4", value === option ? "opacity-100" : "opacity-0")} />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}