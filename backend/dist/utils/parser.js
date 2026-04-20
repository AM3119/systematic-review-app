"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRIS = parseRIS;
exports.parseBibTeX = parseBibTeX;
exports.parseCSV = parseCSV;
function parseRIS(content) {
    const articles = [];
    const records = content.split(/\nER\s*[-\n]|\r\nER\s*[-\r\n]/);
    for (const record of records) {
        if (!record.trim())
            continue;
        const article = {
            title: '', authors: '', abstract: '', journal: '',
            volume: '', issue: '', pages: '', doi: '', pmid: '',
            url: '', source_db: '', keywords: ''
        };
        const authorsList = [];
        const keywordsList = [];
        const lines = record.split(/\r?\n/);
        for (const line of lines) {
            const match = line.match(/^([A-Z][A-Z0-9])\s*-\s*(.+)$/);
            if (!match)
                continue;
            const [, tag, value] = match;
            const v = value.trim();
            switch (tag) {
                case 'TI':
                case 'T1':
                case 'CT':
                    article.title = article.title || v;
                    break;
                case 'AU':
                case 'A1':
                case 'A2':
                    authorsList.push(v);
                    break;
                case 'AB':
                case 'N2':
                    article.abstract = article.abstract || v;
                    break;
                case 'JO':
                case 'JF':
                case 'J1':
                case 'J2':
                case 'T2':
                    article.journal = article.journal || v;
                    break;
                case 'PY':
                case 'Y1':
                case 'DA': {
                    const yr = parseInt(v.substring(0, 4));
                    if (!isNaN(yr))
                        article.year = yr;
                    break;
                }
                case 'VL':
                    article.volume = v;
                    break;
                case 'IS':
                    article.issue = v;
                    break;
                case 'SP':
                    article.pages = v + (article.pages ? `-${article.pages}` : '');
                    break;
                case 'EP':
                    article.pages = article.pages ? `${article.pages}-${v}` : v;
                    break;
                case 'DO':
                case 'DI':
                    article.doi = v;
                    break;
                case 'AN':
                    if (v.startsWith('PMID:'))
                        article.pmid = v.replace('PMID:', '').trim();
                    break;
                case 'UR':
                case 'L1':
                    article.url = article.url || v;
                    break;
                case 'DB':
                    article.source_db = v;
                    break;
                case 'KW':
                case 'DE':
                    keywordsList.push(v);
                    break;
            }
        }
        if (authorsList.length)
            article.authors = authorsList.join('; ');
        if (keywordsList.length)
            article.keywords = keywordsList.join('; ');
        if (article.title)
            articles.push(article);
    }
    return articles;
}
function parseBibTeX(content) {
    const articles = [];
    const entryRegex = /@\w+\s*\{[^@]*/g;
    const matches = content.match(entryRegex) || [];
    for (const entry of matches) {
        const article = {
            title: '', authors: '', abstract: '', journal: '',
            volume: '', issue: '', pages: '', doi: '', pmid: '',
            url: '', source_db: 'BibTeX', keywords: ''
        };
        const getField = (field) => {
            const r = new RegExp(`${field}\\s*=\\s*[{"]([^}"]+)[}"]`, 'i');
            const m = entry.match(r);
            return m ? m[1].trim() : '';
        };
        article.title = getField('title').replace(/[{}]/g, '');
        const rawAuthors = getField('author');
        if (rawAuthors) {
            article.authors = rawAuthors.split(' and ').map(a => a.trim()).join('; ');
        }
        article.abstract = getField('abstract');
        article.journal = getField('journal') || getField('booktitle');
        const yr = parseInt(getField('year'));
        if (!isNaN(yr))
            article.year = yr;
        article.volume = getField('volume');
        article.issue = getField('number');
        article.pages = getField('pages');
        article.doi = getField('doi');
        article.url = getField('url');
        article.keywords = getField('keywords');
        if (article.title)
            articles.push(article);
    }
    return articles;
}
function parseCSV(content) {
    const lines = content.split(/\r?\n/);
    if (lines.length < 2)
        return [];
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').toLowerCase().trim());
    const articles = [];
    const getCol = (row, name) => {
        const variants = [name, name.replace(' ', '_'), name.replace('_', ' ')];
        for (const v of variants) {
            const idx = headers.indexOf(v);
            if (idx !== -1)
                return (row[idx] || '').replace(/"/g, '').trim();
        }
        return '';
    };
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const title = getCol(cols, 'title');
        if (!title)
            continue;
        const article = {
            title,
            authors: getCol(cols, 'authors') || getCol(cols, 'author'),
            abstract: getCol(cols, 'abstract'),
            journal: getCol(cols, 'journal') || getCol(cols, 'source'),
            volume: getCol(cols, 'volume'),
            issue: getCol(cols, 'issue') || getCol(cols, 'number'),
            pages: getCol(cols, 'pages'),
            doi: getCol(cols, 'doi'),
            pmid: getCol(cols, 'pmid'),
            url: getCol(cols, 'url'),
            source_db: getCol(cols, 'database') || 'CSV',
            keywords: getCol(cols, 'keywords'),
        };
        const yr = parseInt(getCol(cols, 'year') || getCol(cols, 'publication_year'));
        if (!isNaN(yr))
            article.year = yr;
        articles.push(article);
    }
    return articles;
}
