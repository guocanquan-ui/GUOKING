/**
 * Host half of the Quick Notes bundle.
 *
 * The feature is browser-local: notes live in the page's localStorage, so the
 * Host contributes no services, tools, or configuration. This apply exists so
 * the bundle has an enabled Loader row, which is what makes the module graph
 * publish the `./client` half and its sidebar entry.
 */
export function apply() {}
