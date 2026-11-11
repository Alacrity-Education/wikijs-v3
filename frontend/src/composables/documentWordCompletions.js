import * as monaco from 'monaco-editor'
import { Range } from 'monaco-editor'

/**
 * Monaco's own word definition, for a model whose language sets none: a number, or a run of anything
 * but punctuation and whitespace. Copied from `DEFAULT_WORD_REGEXP`, which Monaco does not export.
 */
const DEFAULT_WORD_PATTERN = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/gu

/** The most words offered, as Monaco's own word completion caps them. */
const MAX_WORDS = 10000

/**
 * Word completion -- the words already in the document, offered as they are typed -- in place of
 * Monaco's own, which offers every word of the source with no way to leave any out. In a page that
 * holds a drawing that is tens of kilobytes of base64 or draw.io XML, each fragment of it a "word":
 * the list fills with them, and Monaco's cap of 10000 words can be reached before the prose is.
 *
 * So the editor's own model is read with the regions `excludedRegions` names left out -- every drawing,
 * see `useBlockFolding`'s `drawingRegions` -- and only that model: Monaco's reads every model of the
 * language, which is nothing a page needs.
 *
 * Monaco's has to be switched off for this to replace it, and that is a setting of every editor on the
 * page, not of one: standalone Monaco keeps editor options in one shared configuration. So this
 * provider answers for any model, each with its own words, for as long as it is registered, and
 * `dispose()` switches Monaco's back on. It is registered for every language (`*`) as Monaco's is,
 * which keeps it where Monaco's was: offered only when no provider for the language has anything to
 * say -- block names, link targets and the like come first, without words mixed in.
 *
 * Call `register()` once the editor exists, and `dispose()` before the editor is.
 *
 * @param {object} opts
 * @param {() => object} opts.getEditor The Monaco editor, once there is one.
 * @param {RegExp} opts.wordPattern What a word is in the editor's language, with the `g` flag: the
 *        `wordPattern` its language configuration was given.
 * @param {(text: string) => Array<{ start: number, end: number }>} opts.excludedRegions Folding
 *        ranges, 1-based: the lines after each `start`, up to and including `end`, are not read.
 */
export function useDocumentWordCompletions({ getEditor, wordPattern, excludedRegions }) {
  let provider = null

  /** The words last read, and the model version they were read from: typing asks again per key. */
  let cache = { model: null, version: -1, words: [] }

  function register() {
    getEditor().updateOptions({ wordBasedSuggestions: 'off' })
    provider = monaco.languages.registerCompletionItemProvider('*', { provideCompletionItems })
  }

  function dispose() {
    provider?.dispose()
    provider = null
    cache = { model: null, version: -1, words: [] }
    // -> Monaco's default, back for every editor left on the page
    getEditor()?.updateOptions({ wordBasedSuggestions: 'matchingDocuments' })
  }

  /** Every distinct word of the model, in order, past the regions left out of it. */
  function wordsOf(model) {
    if (cache.model === model && cache.version === model.getVersionId()) {
      return cache.words
    }
    const isPage = model === getEditor()?.getModel()
    const pattern = new RegExp(
      isPage ? wordPattern.source : DEFAULT_WORD_PATTERN.source,
      isPage ? wordPattern.flags : DEFAULT_WORD_PATTERN.flags
    )
    const lines = model.getLinesContent()
    const skipped = new Set()
    if (isPage) {
      for (const { start, end } of excludedRegions(model.getValue())) {
        for (let line = start + 1; line <= end; line++) {
          skipped.add(line)
        }
      }
    }
    const seen = new Set()
    outer: for (let index = 0; index < lines.length; index++) {
      if (skipped.has(index + 1)) {
        continue
      }
      for (const [word] of lines[index].matchAll(pattern)) {
        // -> A number is not worth offering, as Monaco's own leaves them out
        if (word && Number.isNaN(Number(word))) {
          seen.add(word)
          if (seen.size >= MAX_WORDS) {
            break outer
          }
        }
      }
    }
    cache = { model, version: model.getVersionId(), words: [...seen] }
    return cache.words
  }

  /** The words, but the one being typed -- offering it back to itself is no completion. */
  function provideCompletionItems(model, position) {
    const word = model.getWordAtPosition(position)
    const replace = word
      ? new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      : Range.fromPositions(position)
    const insert = replace.setEndPosition(position.lineNumber, position.column)
    return {
      suggestions: wordsOf(model)
        .filter((entry) => entry !== word?.word)
        .map((entry) => ({
          kind: monaco.languages.CompletionItemKind.Text,
          label: entry,
          insertText: entry,
          range: { insert, replace }
        }))
    }
  }

  return { register, dispose }
}
