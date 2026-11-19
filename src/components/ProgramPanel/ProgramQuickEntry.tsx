import { useId, useState, type FormEvent } from 'react'
import { MAX_SECTIONS } from '../../core/constants'
import { parseProgram, programToText, toSections } from '../../core/programText'
import { toCurrent } from '../../core/settings'
import type { Settings } from '../../core/types'
import type { SettingsUpdater } from '../../state/useSettings'
import { EditIcon, PlusIcon } from '../icons/icons'
import { Button, IconButton } from '../ui/ui'

interface ProgramQuickEntryProps {
  settings: Settings
  onChange: SettingsUpdater
  /** Announces what happened (screen-reader status line of the program panel). */
  onStatus: (message: string) => void
}

const EXAMPLE = '3/8x3, 4/4x2@140, [7/8(2+2+3)x2, 4/4]x2'
const SYNTAX_HELP =
  'beats/unit, then xBars, @tempo, (grouping) — e.g. 4/4x8@140, 7/8(2+2+3)x2. ' +
  'Name a section with name: (verse:3/4x8). Repeat a group with [ … ]x3. Separate sections with commas.'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Type a whole program in one line, Emmet style: "3/8x3, 4/4x2" makes 3 bars of 3/8 then 2 of 4/4.
 * Enter replaces the program (and switches program mode on); Append adds to the end.
 */
export function ProgramQuickEntry({ settings, onChange, onStatus }: ProgramQuickEntryProps) {
  const id = useId()
  const [text, setText] = useState('')
  const empty = text.trim() === ''
  const result = empty ? null : parseProgram(text)
  const parsed = result?.ok ? result.sections : null
  const canAppend = parsed !== null && settings.sections.length + parsed.length <= MAX_SECTIONS

  function replace(e?: FormEvent) {
    e?.preventDefault()
    if (!parsed) return
    const sections = toSections(parsed)
    onChange((prev) => ({
      ...prev,
      sections,
      activeSection: 0,
      current: toCurrent(sections[0]),
      program: { ...prev.program, enabled: true },
    }))
    setText('')
    onStatus(`Program replaced: ${plural(sections.length, 'section')}.`)
  }

  function append() {
    if (!parsed || !canAppend) return
    const sections = toSections(parsed, settings.sections.length + 1)
    onChange((prev) =>
      prev.sections.length + sections.length > MAX_SECTIONS
        ? prev
        : { ...prev, sections: [...prev.sections, ...sections], program: { ...prev.program, enabled: true } },
    )
    setText('')
    onStatus(`Added ${plural(sections.length, 'section')}.`)
  }

  let preview: string
  let tone = ''
  if (result === null) {
    preview = SYNTAX_HELP
  } else if (result.ok) {
    const bars = result.sections.reduce((sum, s) => sum + s.bars, 0)
    preview = `${plural(result.sections.length, 'section')} · ${plural(bars, 'bar')} — Enter replaces the program`
    tone = ' is-ok'
  } else {
    preview = `${result.error} (at character ${result.at + 1})`
    tone = ' is-error'
  }

  return (
    <form className="program-quick" onSubmit={replace}>
      <div className="program-quick__row">
        <label className="sr-only" htmlFor={`${id}-text`}>
          Program as text
        </label>
        <input
          id={`${id}-text`}
          className="program-quick__input"
          type="text"
          value={text}
          placeholder={EXAMPLE}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-describedby={`${id}-preview`}
          aria-invalid={result !== null && !result.ok}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text !== '') {
              e.preventDefault()
              e.stopPropagation()
              setText('')
            }
          }}
        />
        <IconButton
          size="sm"
          label="Write the current program as text"
          icon={<EditIcon size={16} />}
          onClick={() => setText(programToText(settings.sections))}
        />
        <Button size="sm" variant="primary" type="submit" disabled={!parsed}>
          Replace
        </Button>
        <Button
          size="sm"
          icon={<PlusIcon size={16} />}
          disabled={!canAppend}
          title={parsed && !canAppend ? `A program has at most ${MAX_SECTIONS} sections` : 'Add these sections at the end'}
          onClick={append}
        >
          Append
        </Button>
      </div>
      <p id={`${id}-preview`} className={`program-quick__preview${tone}`}>
        {preview}
      </p>
    </form>
  )
}
