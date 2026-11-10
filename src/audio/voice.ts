import { VOICE_PACKS, VOICE_WORDS, voiceSampleUrl } from '../core/constants'
import type { VoicePackId, VoiceWord } from '../core/types'

async function loadWord(ctx: BaseAudioContext, pack: VoicePackId, word: VoiceWord): Promise<AudioBuffer> {
  const response = await fetch(voiceSampleUrl(pack, word))
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`)
  return ctx.decodeAudioData(await response.arrayBuffer())
}

/**
 * Fetch and decode every sample of a voice pack (voiceSampleUrl for each of VOICE_WORDS) in parallel.
 * Words that fail to load are left out of the map instead of failing the whole pack; rejects only when
 * nothing at all could be loaded.
 */
export async function loadVoicePack(ctx: BaseAudioContext, pack: VoicePackId): Promise<Map<VoiceWord, AudioBuffer>> {
  const results = await Promise.allSettled(VOICE_WORDS.map((word) => loadWord(ctx, pack, word)))
  const words = new Map<VoiceWord, AudioBuffer>()
  const failures: unknown[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') words.set(VOICE_WORDS[i], result.value)
    else failures.push(result.reason)
  })
  if (words.size === 0) {
    const label = VOICE_PACKS.find((p) => p.id === pack)?.label ?? pack
    throw new Error(`The voice "${label}" could not be loaded`, { cause: failures[0] })
  }
  if (failures.length > 0) console.warn(`Voice ${pack}: ${failures.length} sample(s) failed to load`, failures)
  return words
}
