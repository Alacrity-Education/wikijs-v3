/**
 * FORK-ONLY. Where to send the reader once the page they were reading has been deleted.
 *
 * Into the same folder, on another page of it, rather than back to the site's home: whoever deletes a
 * page is usually working through a section, and the home page makes them find their way back to it.
 * Failing that, one folder up at a time -- the folder's own page first (the page sharing the folder's
 * path, which is what a reader thinks of as the folder), then any page beside it -- and the home page
 * last.
 *
 * Asked of `tree/browse`, the reader's own listing: it lists only pages this session may open, live or
 * theirs to see unpublished, so the landing is never a 404. Anything going wrong on the way -- browsing
 * switched off on the site, a network error -- lands on the home page, which is where this used to go.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {string} opts.locale The deleted page's locale, which is the tree that is walked
 * @param {string} opts.path The deleted page's path, slash-separated
 * @param {string} opts.localePrefix What `siteStore.localeUrlPrefix(locale)` answers: empty, or `/fr`
 * @returns {Promise<string>} The route to replace the deleted page's with
 */
export async function pageDeleteLanding({ siteId, locale, path, localePrefix = '' }) {
  const home = localePrefix || '/'
  const parentOf = (p) => p.split('/').slice(0, -1).join('/')
  let folder = parentOf(path ?? '')
  let preferred = null
  try {
    // -> Bounded by the path's own depth: every turn goes up one folder, and the root ends it
    for (;;) {
      const level = await API_CLIENT.get(`sites/${siteId}/tree/browse`, {
        searchParams: { locale, ...(folder ? { path: folder } : {}) }
      }).json()
      const pages = (level?.items ?? []).filter((item) => item.isPage && item.path !== path)
      const pick = pages.find((item) => item.path === preferred) ?? pages[0]
      if (pick) {
        return pick.path === 'home' ? home : `${localePrefix}/${pick.path}`
      }
      if (!folder) {
        return home
      }
      preferred = folder
      folder = parentOf(folder)
    }
  } catch {
    return home
  }
}
