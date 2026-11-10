import { useState, type FormEvent } from 'react'
import { makeId, selectSection } from '../../core/settings'
import type { Settings } from '../../core/types'
import { loadTemplates, saveTemplates, type ProgramTemplate } from '../../state/storage'
import type { SettingsUpdater } from '../../state/useSettings'
import { SaveIcon, TrashIcon } from '../icons/icons'
import { Button, IconButton, Select, type SelectOption } from '../ui/ui'

interface ProgramTemplatesProps {
  settings: Settings
  onChange: SettingsUpdater
  /** Announces what happened (screen-reader status line of the program panel). */
  onStatus: (message: string) => void
}

const NAME_MAX_LENGTH = 40
const NONE = ''

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Program templates, like presets but only for the program: save the section list (and loop) under a name, load it
 * back later, delete it. Saving under an existing name replaces that template.
 */
export function ProgramTemplates({ settings, onChange, onStatus }: ProgramTemplatesProps) {
  const [templates, setTemplates] = useState<ProgramTemplate[]>(loadTemplates)
  const [selected, setSelected] = useState(NONE)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const chosen = templates.find((t) => t.id === selected) ?? null

  function store(next: ProgramTemplate[]) {
    setTemplates(next)
    saveTemplates(next)
  }

  function startNaming() {
    setName(chosen?.name ?? `Program, ${plural(settings.sections.length, 'section')}`)
    setNaming(true)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim().slice(0, NAME_MAX_LENGTH)
    if (trimmed === '') return
    const existing = templates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
    const template: ProgramTemplate = {
      id: existing?.id ?? makeId(),
      name: trimmed,
      sections: settings.sections.map((s) => ({ ...s, beats: [...s.beats] })),
      loop: settings.program.loop,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    store(existing ? templates.map((t) => (t.id === existing.id ? template : t)) : [...templates, template])
    setSelected(template.id)
    setNaming(false)
    onStatus(existing ? `Replaced template ${trimmed}.` : `Saved template ${trimmed}.`)
  }

  function load() {
    if (!chosen) return
    // Fresh ids, so a template loaded twice never shares sections.
    const sections = chosen.sections.map((s) => ({ ...s, id: makeId(), beats: [...s.beats] }))
    onChange((prev) =>
      selectSection({ ...prev, sections, program: { ...prev.program, loop: chosen.loop } }, 0),
    )
    onStatus(`Loaded template ${chosen.name}.`)
  }

  function remove() {
    if (!chosen) return
    store(templates.filter((t) => t.id !== chosen.id))
    setSelected(NONE)
    onStatus(`Deleted template ${chosen.name}.`)
  }

  if (naming) {
    return (
      <form className="program-templates" onSubmit={save}>
        <label className="sr-only" htmlFor="program-template-name">
          Template name
        </label>
        <input
          id="program-template-name"
          className="program-templates__name"
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          enterKeyHint="done"
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setNaming(false)
            }
          }}
        />
        <Button size="sm" variant="primary" type="submit" disabled={name.trim() === ''}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
          Cancel
        </Button>
      </form>
    )
  }

  const options: SelectOption<string>[] = [
    { value: NONE, label: templates.length === 0 ? 'No templates yet' : 'Templates…' },
    ...templates.map((t) => ({ value: t.id, label: `${t.name} (${plural(t.sections.length, 'section')})` })),
  ]

  return (
    <div className="program-templates" role="group" aria-label="Program templates">
      <Select
        className="program-templates__select"
        label="Program template"
        hideLabel
        value={chosen ? chosen.id : NONE}
        options={options}
        disabled={templates.length === 0}
        onChange={setSelected}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!chosen}
        title={chosen ? `Replace the sections with ${chosen.name}` : 'Pick a template first'}
        onClick={load}
      >
        Load
      </Button>
      <IconButton
        size="sm"
        label={chosen ? `Delete template ${chosen.name}` : 'Delete template'}
        icon={<TrashIcon size={16} />}
        disabled={!chosen}
        onClick={remove}
      />
      <Button
        size="sm"
        variant="secondary"
        className="program-templates__save"
        icon={<SaveIcon size={16} />}
        title="Save these sections (and loop) as a template"
        onClick={startNaming}
      >
        Save template
      </Button>
    </div>
  )
}
