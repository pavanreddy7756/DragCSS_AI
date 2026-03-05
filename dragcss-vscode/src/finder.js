// DragCSS — CSS File Finder
// Searches workspace for CSS/SCSS/Less files that contain matching selectors

const vscode = require('vscode');

class CSSFileFinder {
  /**
   * Find files in the workspace containing CSS rules that match a given selector.
   * @param {string} selector — CSS selector like "div.card > h2:nth-of-type(1)"
   * @returns {Promise<Array<{uri: vscode.Uri, range: vscode.Range, fullSelector: string}>>}
   */
  async findFilesForSelector(selector) {
    const results = [];

    // Extract searchable parts from the selector
    const searchTerms = this._extractSearchTerms(selector);

    if (searchTerms.length === 0) return results;

    // Search through CSS/SCSS/Less/Stylus files
    const filePatterns = '**/*.{css,scss,sass,less,styl}';
    const files = await vscode.workspace.findFiles(filePatterns, '**/node_modules/**', 100);

    for (const fileUri of files) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();

      // Try each search term (from most specific to least specific)
      for (const term of searchTerms) {
        const matches = this._findSelectorInText(text, term, selector);

        for (const match of matches) {
          const startPos = doc.positionAt(match.start);
          const endPos = doc.positionAt(match.end);
          results.push({
            uri: fileUri,
            range: new vscode.Range(startPos, endPos),
            fullSelector: match.selector
          });
        }

        if (matches.length > 0) break; // Use the most specific match found
      }
    }

    return results;
  }

  /**
   * Extract searchable terms from a CSS selector, ordered from most specific to least.
   * "div.card > h2:nth-of-type(1)" → [".card", "div.card", "h2"]
   */
  _extractSearchTerms(selector) {
    const terms = [];

    // Extract ID if present — most specific
    const idMatch = selector.match(/#([\w-]+)/);
    if (idMatch) {
      terms.push('#' + idMatch[1]);
    }

    // Extract class names — very specific
    const classMatches = selector.match(/\.([\w-]+)/g);
    if (classMatches) {
      // Push individual classes
      for (const cls of classMatches) {
        if (!terms.includes(cls)) terms.push(cls);
      }
    }

    // Extract tag.class combinations
    const tagClassMatches = selector.match(/(\w+\.\w[\w.-]*)/g);
    if (tagClassMatches) {
      for (const tc of tagClassMatches) {
        // Remove :nth-of-type etc. for file-level search
        const clean = tc.replace(/:[^.]+/g, '');
        if (!terms.includes(clean)) terms.push(clean);
      }
    }

    // Extract bare tag names (last resort)
    const parts = selector.split(/[\s>+~]+/);
    for (const part of parts) {
      const tag = part.replace(/[.#:\[].*/g, '').trim();
      if (tag && tag.length > 1 && !terms.includes(tag)) {
        terms.push(tag);
      }
    }

    return terms;
  }

  /**
   * Find a selector pattern within CSS text, returning the position of the rule block.
   * @param {string} text — Full file text
   * @param {string} searchTerm — Term to search for (e.g., ".card")
   * @param {string} originalSelector — Original full selector for scoring
   * @returns {Array<{start: number, end: number, selector: string}>}
   */
  _findSelectorInText(text, searchTerm, originalSelector) {
    const matches = [];
    // Escape special regex chars in the search term
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Look for the term as part of a CSS selector (followed eventually by {)
    const regex = new RegExp(
      // Selector start: beginning of line, comma, or whitespace
      '(?:^|[,}\\s])\\s*' +
      // The selector containing our search term
      '([^{}]*?' + escaped + '[^{]*?)' +
      // Opening brace
      '\\s*\\{',
      'gm'
    );

    let match;
    while ((match = regex.exec(text)) !== null) {
      const selectorText = match[1].trim();

      // Find the full rule block (selector + { ... })
      const braceStart = text.indexOf('{', match.index + match[0].indexOf('{'));
      if (braceStart === -1) continue;

      const braceEnd = this._findClosingBrace(text, braceStart);
      if (braceEnd === -1) continue;

      matches.push({
        start: match.index + match[0].indexOf(selectorText),
        end: braceEnd + 1,
        selector: selectorText
      });
    }

    return matches;
  }

  /**
   * Find the matching closing brace for an opening brace.
   */
  _findClosingBrace(text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
}

module.exports = { CSSFileFinder };
