(function (root) {
  'use strict';

  function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(label + ' must be a number.');
    return number;
  }

  function positive(value, label) {
    const number = finite(value, label);
    if (number <= 0) throw new Error(label + ' must be greater than zero.');
    return number;
  }

  function nonNegative(value, label) {
    const number = finite(value, label);
    if (number < 0) throw new Error(label + ' cannot be negative.');
    return number;
  }

  function format(value) {
    return Number(value).toFixed(6).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  // GcodePreprocessorUtils.splitCommand, ported: a word is a letter run
  // immediately followed by a numeric run (digits/'.'/'-'), whitespace is
  // dropped without ending a word, and '(' / ';' start a comment that runs to
  // the matching ')' / the end of the line. Needed here (not just something
  // the real backend does) to check *its* tokenization, not any more
  // sensible one - see findUnsafeProbeLine below for why.
  function splitCommand(command) {
    if (command.startsWith('$')) return [command];
    const words = [];
    let readNumeric = false;
    let readLineComment = false;
    let blockDepth = 0;
    let current = '';
    for (const c of command) {
      if (c === '(' && !readLineComment) {
        if (blockDepth === 0 && current) { words.push(current); current = ''; }
        current += c;
        blockDepth++;
        readNumeric = false;
        continue;
      }
      if (blockDepth > 0 && c === ')') {
        current += c;
        blockDepth--;
        if (blockDepth === 0) { words.push(current); current = ''; }
        continue;
      }
      if (c === ';' && !readLineComment && blockDepth === 0) {
        if (current) { words.push(current); current = ''; }
        current += c;
        readLineComment = true;
        continue;
      }
      if (readLineComment || blockDepth > 0) {
        current += c;
      } else if (/\s/.test(c)) {
        continue;
      } else if (readNumeric && !/[0-9]/.test(c) && c !== '.') {
        readNumeric = false;
        words.push(current);
        current = /[A-Za-z]/.test(c) ? c : '';
      } else if (/[0-9.-]/.test(c)) {
        current += c;
        readNumeric = true;
      } else if (/[A-Za-z]/.test(c)) {
        current += c;
      }
    }
    if (current) words.push(current);
    return words;
  }

  // F/S/T are the only address letters the real backend's parser can outright
  // choke on: a word starting with one of them has its rest parsed straight
  // as a number (GcodeParserUtils.processCommand), and a value that isn't one
  // throws and aborts the whole file - reported as "Multiple F/S/T-codes on
  // one line" regardless of whether there's actually more than one (the same
  // exception covers both cases). G/M words never throw this way - an
  // unrecognised one is just ignored. Custom probe code is pasted in
  // verbatim with no validation at all otherwise, so plain text containing a
  // stray "T..." or "S..." word (confirmed: an ordinary English sentence
  // does this by accident, via splitCommand's own comment/number-boundary
  // rules) silently produces a file that saves fine here but throws the
  // moment Dashboard re-opens it - far enough from the actual mistake to be
  // genuinely confusing. Checked eagerly, before that ever happens.
  function findUnsafeProbeLine(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const seenByAddress = { F: 0, S: 0, T: 0 };
      for (const word of splitCommand(lines[i])) {
        if (!word || word.startsWith('(') || word.startsWith(';') || word.startsWith('$')) continue;
        const address = word[0].toUpperCase();
        if (address !== 'F' && address !== 'S' && address !== 'T') continue;
        // Matches Iterables.getOnlyElement's own condition in the real parser:
        // it throws just the same for a second occurrence of the address as
        // for a first one that isn't a clean number.
        seenByAddress[address]++;
        if (seenByAddress[address] > 1 || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(word.slice(1))) {
          return { lineNumber: i + 1, line: lines[i], word };
        }
      }
    }
    return null;
  }

  function generate(options) {
    const direction = String(options.direction || '').toUpperCase();
    const directionMatch = /^([XY])([+-])$/.exec(direction);
    if (!directionMatch) throw new Error('Choose a cut direction.');

    const axis = directionMatch[1];
    const sign = directionMatch[2] === '-' ? '-' : '';
    const distance = positive(options.distance, 'Distance');
    const speed = positive(options.cutSpeed, 'Cut speed');
    const safeHeight = finite(options.safeHeight, 'Safe move height');
    const pierceHeight = finite(options.pierceHeight, 'Pierce height');
    const cutHeight = finite(options.cutHeight, 'Cut height');
    const pierceDelay = nonNegative(options.pierceDelay, 'Pierce delay');
    const units = options.units === 'inch' ? 'G20' : 'G21';
    const probe = String(options.probeCode || '').replace(/\r\n?/g, '\n').trim();
    const thc = Boolean(options.thc);

    if (probe) {
      const unsafe = findUnsafeProbeLine(probe);
      if (unsafe) {
        throw new Error(
          `Custom probe code, line ${unsafe.lineNumber}: '${unsafe.word}' looks like an F, S, or T word but isn't ` +
          `a plain number - Dashboard's parser will reject the whole file the moment it reopens it. Line: "${unsafe.line.trim()}"`
        );
      }
    }

    const lines = [
      '; Straight Cut generated by UGS Dashboard',
      `; Direction ${direction} · Distance ${format(distance)} ${options.units === 'inch' ? 'in' : 'mm'}`,
      'G90',
      units,
      // X0 Y0 on this first move states outright what every other line already
      // assumes - the cut starts at the active work origin - since the file never
      // otherwise mentions the axis that isn't being cut (Y for an X cut, X for a
      // Y cut). Without an explicit word for it, UGS's own position tracking (and
      // so the Dashboard visualizer) has no numeric value for that axis anywhere
      // in the file and drops every segment as a result - nothing rendered, even
      // though the file ran on the machine exactly as documented. This changes
      // nothing about where the machine actually goes for the documented
      // "starts from the active work origin" use - it only writes out the
      // starting position the file already relies on.
      `G0 X0 Y0 Z${format(safeHeight)}`,
    ];

    if (probe) lines.push('; Custom probe code', ...probe.split('\n'));

    lines.push(
      `G0 Z${format(pierceHeight)}`,
      'M3',
      `G4 P${format(pierceDelay)}`,
      `G0 Z${format(cutHeight)}`,
    );

    if (thc) lines.push('M8');

    lines.push(`G1 ${axis}${sign}${format(distance)} F${format(speed)}`, 'M5');

    if (thc) lines.push('G4 P0.5', 'M9');

    lines.push(`G0 Z${format(safeHeight)}`);
    return lines.join('\n') + '\n';
  }

  root.StraightCut = { generate };
})(window);
