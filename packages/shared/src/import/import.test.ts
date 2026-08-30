import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCsv } from './csv.ts';
import { collapseHeader, detectSource, resolveColumns } from './columns.ts';
import { exerciseMatchKey, inferEquipment, inferMuscles, inferTrackingType } from './exercises.ts';
import { buildImportMatchIndex, matchImportedName } from './match.ts';
import {
  collectExerciseNames,
  countSets,
  filterWorkoutsSince,
  ImportFormatError,
  importCutoff,
  parseWorkoutCsv,
} from './parse.ts';
import { identifyRoutines } from './routines.ts';
import {
  detectDateOrder,
  parseNumber,
  parseSeconds,
  parseSetType,
  parseTimestamp,
} from './values.ts';

/** Local wall-clock, so these assertions hold in every timezone CI runs in. */
const local = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number => new Date(year, month - 1, day, hour, minute, second).getTime();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real Hevy export, trimmed. Header and quoting are verbatim. */
const HEVY_CSV = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Seated Leg Curl (Machine)",,"",0,"warmup",52,5,,,
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Seated Leg Curl (Machine)",,"",1,"normal",60,5,,,
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Leg Extension (Machine)",,"slow negatives",0,"normal",75,8,,,8
"legs","21 May 2025, 20:44","21 May 2025, 22:03","felt strong","Leg Extension (Machine)",,"slow negatives",1,"failure",70,7,,,10
"upper 1","19 May 2025, 22:24","19 May 2025, 23:30","","Incline Bench Press (Dumbbell)",,"",0,"normal",72,4,,,
"upper 1","19 May 2025, 22:24","19 May 2025, 23:30","","Lat Pulldown (Cable)",,"",0,"normal",85,6,,,`;

/** What `writeCsvFile` in `features/backup` produces. */
const LIFT_CSV = `Date,Workout,Exercise,Set Type,Weight (kg),Reps,Duration (s),Distance (km),RPE
2026-08-18T17:30:00.000Z,Push day,Bench Press (Barbell),warmup,40,10,,,
2026-08-18T17:30:00.000Z,Push day,Bench Press (Barbell),normal,80,5,,,9
2026-08-18T17:30:00.000Z,Push day,Plank,normal,,,90,,`;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('reads quoted fields containing the delimiter, quotes and newlines', () => {
    const table = parseCsv('a,b\n"x,1","he said ""hi""\nand left"\n');

    assert.deepEqual(table.header, ['a', 'b']);
    assert.deepEqual(table.rows, [['x,1', 'he said "hi"\nand left']]);
  });

  it('detects a semicolon delimiter', () => {
    const table = parseCsv('Date;Exercise;Weight\n2025-01-02;Squat;100');

    assert.equal(table.delimiter, ';');
    assert.deepEqual(table.header, ['Date', 'Exercise', 'Weight']);
  });

  it('strips the byte-order mark Excel writes', () => {
    const table = parseCsv('﻿title,reps\nlegs,5');
    assert.deepEqual(table.header, ['title', 'reps']);
  });

  it('pads short rows and drops the trailing blank line', () => {
    const table = parseCsv('a,b,c\n1,2\n');
    assert.deepEqual(table.rows, [['1', '2', '']]);
  });

  it('handles CRLF and lone-CR line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n').rows, [['1', '2']]);
    assert.deepEqual(parseCsv('a,b\r1,2').rows, [['1', '2']]);
  });
});

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

describe('resolveColumns', () => {
  it('collapses the three spellings of the same header', () => {
    assert.equal(collapseHeader('Weight (kg)'), 'weight kg');
    assert.equal(collapseHeader('weight_kg'), 'weight kg');
    assert.equal(collapseHeader('weightKg'), 'weight kg');
  });

  it('maps a Hevy header', () => {
    const { index } = resolveColumns(parseCsv(HEVY_CSV).header);

    assert.equal(index.workoutTitle, 0);
    assert.equal(index.startTime, 1);
    assert.equal(index.endTime, 2);
    assert.equal(index.workoutNotes, 3);
    assert.equal(index.exercise, 4);
    assert.equal(index.supersetId, 5);
    assert.equal(index.exerciseNotes, 6);
    assert.equal(index.setIndex, 7);
    assert.equal(index.setType, 8);
    assert.equal(index.weight, 9);
    assert.equal(index.reps, 10);
    assert.equal(index.distance, 11);
    assert.equal(index.setDuration, 12);
    assert.equal(index.rpe, 13);
  });

  it('gives "exercise title" to the exercise rather than the workout', () => {
    const { index } = resolveColumns(['title', 'exercise title', 'reps']);

    assert.equal(index.workoutTitle, 0);
    assert.equal(index.exercise, 1);
  });

  it('does not let one column serve two fields', () => {
    const { index } = resolveColumns(['Set', 'Set Type', 'Reps']);

    assert.equal(index.setType, 1);
    assert.equal(index.setIndex, 0);
  });

  it('reads the unit out of the weight header', () => {
    assert.equal(resolveColumns(['Weight (lbs)']).weightUnit, 'lb');
    assert.equal(resolveColumns(['weight_kg']).weightUnit, 'kg');
    assert.equal(resolveColumns(['Weight']).weightUnit, null);
  });

  it('reports headers it made no use of', () => {
    const { unmatched } = resolveColumns(['title', 'exercise', 'reps', 'mood']);
    assert.deepEqual(unmatched, ['mood']);
  });
});

describe('detectSource', () => {
  it('recognises the apps it knows by name', () => {
    assert.equal(detectSource(parseCsv(HEVY_CSV).header), 'hevy');
    assert.equal(detectSource(parseCsv(LIFT_CSV).header), 'lift');
    assert.equal(detectSource(['excercise name', 'reps']), 'lyfta');
  });

  it('does not refuse a file it cannot place', () => {
    assert.equal(detectSource(['when', 'movement', 'reps']), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

describe('parseNumber', () => {
  it('reads both decimal conventions', () => {
    assert.equal(parseNumber('52.5'), 52.5);
    assert.equal(parseNumber('52,5'), 52.5);
    assert.equal(parseNumber('1,234.56'), 1234.56);
    assert.equal(parseNumber('1.234,56'), 1234.56);
    assert.equal(parseNumber('1,234'), 1234);
  });

  it('strips a unit the exporter put in the cell', () => {
    assert.equal(parseNumber('100 kg'), 100);
    assert.equal(parseNumber('225lbs'), 225);
  });

  it('returns null for the many spellings of nothing', () => {
    for (const blank of ['', '   ', '-', 'null', 'N/A']) {
      assert.equal(parseNumber(blank), null, blank);
    }
  });

  it('keeps zero, which is a real bodyweight load', () => {
    assert.equal(parseNumber('0'), 0);
  });
});

describe('parseSeconds', () => {
  it('reads counts, clocks and spelled-out spans', () => {
    assert.equal(parseSeconds('90'), 90);
    assert.equal(parseSeconds('2:30'), 150);
    assert.equal(parseSeconds('01:06:25'), 3985);
    assert.equal(parseSeconds('1h 30m'), 5400);
    assert.equal(parseSeconds('45s'), 45);
  });

  it('reads a two-part clock as minutes and seconds', () => {
    assert.equal(parseSeconds('2:30'), 150);
  });

  it('returns null rather than zero when there is nothing to read', () => {
    assert.equal(parseSeconds(''), null);
    assert.equal(parseSeconds('soon'), null);
  });
});

describe('parseTimestamp', () => {
  it("reads Hevy's format", () => {
    assert.equal(parseTimestamp('21 May 2025, 20:44'), local(2025, 5, 21, 20, 44));
  });

  it('reads ISO with and without a zone', () => {
    assert.equal(parseTimestamp('2026-08-18T17:30:00.000Z'), Date.UTC(2026, 7, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18T17:30:00'), local(2026, 8, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18 17:30'), local(2026, 8, 18, 17, 30));
    assert.equal(parseTimestamp('2026-08-18'), local(2026, 8, 18));
  });

  it('reads a twelve-hour clock', () => {
    assert.equal(parseTimestamp('5/21/2025 8:44 PM', 'mdy'), local(2025, 5, 21, 20, 44));
    assert.equal(parseTimestamp('5/21/2025 12:30 AM', 'mdy'), local(2025, 5, 21, 0, 30));
  });

  it('honours the day/month order it is given', () => {
    assert.equal(parseTimestamp('5/6/2025', 'dmy'), local(2025, 6, 5));
    assert.equal(parseTimestamp('5/6/2025', 'mdy'), local(2025, 5, 6));
  });

  it('lets an impossible month override the order', () => {
    assert.equal(parseTimestamp('21/05/2025', 'mdy'), local(2025, 5, 21));
  });

  it('rejects a date that would silently roll over', () => {
    assert.equal(parseTimestamp('31/02/2025'), null);
  });

  it('rejects text and implausible years', () => {
    assert.equal(parseTimestamp('yesterday'), null);
    assert.equal(parseTimestamp('01 Jan 1923, 10:00'), null);
  });

  it('reads epoch seconds and milliseconds', () => {
    assert.equal(parseTimestamp('1747852800'), 1747852800000);
    assert.equal(parseTimestamp('1747852800000'), 1747852800000);
  });
});

describe('parseTimestamp: localised month names', () => {
  /**
   * Twelve month words in order, in Hevy's own date shape.
   *
   * Every word below is what `Intl.DateTimeFormat` returns for that locale, so
   * these cases are the export a phone in that language actually writes rather
   * than a translation of the English list.
   */
  const readsYear = (...names: readonly string[]): void => {
    assert.equal(names.length, 12);
    names.forEach((name, index) => {
      assert.equal(
        parseTimestamp(`21 ${name} 2025, 20:44`),
        local(2025, index + 1, 21, 20, 44),
        name,
      );
    });
  };

  it('reads Spanish', () => {
    readsYear('ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic');
    readsYear(
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    );
  });

  it('reads German, accents and all', () => {
    readsYear('Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez');
    readsYear(
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    );
    // German dates carry an ordinal dot the English ones do not.
    assert.equal(parseTimestamp('21. März 2025, 20:44'), local(2025, 3, 21, 20, 44));
  });

  it('reads French, including the four-letter July it needs', () => {
    readsYear(
      'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
      'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
    );
    readsYear(
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    );
    // The 1990 spelling of août, which drops the circumflex.
    assert.equal(parseTimestamp('21 aout 2025'), local(2025, 8, 21));
  });

  it('reads Portuguese, connectors and all', () => {
    readsYear(
      'jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.',
      'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.',
    );
    readsYear(
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    );
    assert.equal(parseTimestamp('21 de mai. de 2025'), local(2025, 5, 21));
    assert.equal(parseTimestamp('21 de maio de 2025, 20:44'), local(2025, 5, 21, 20, 44));
  });

  it('reads Italian', () => {
    readsYear('gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic');
    readsYear(
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
    );
  });

  it('reads Dutch', () => {
    readsYear('jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec');
    readsYear(
      'januari', 'februari', 'maart', 'april', 'mei', 'juni',
      'juli', 'augustus', 'september', 'oktober', 'november', 'december',
    );
  });

  it('reads Swedish, Danish and Norwegian', () => {
    readsYear(
      'jan.', 'feb.', 'mars', 'apr.', 'maj', 'juni',
      'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.',
    );
    readsYear(
      'januar', 'februar', 'marts', 'april', 'maj', 'juni',
      'juli', 'august', 'september', 'oktober', 'november', 'december',
    );
    readsYear('jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des');
  });

  it('reads Polish and Czech, in the genitive their dates use', () => {
    readsYear('sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru');
    readsYear(
      'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
      'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
    );
    readsYear('led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro');
    readsYear(
      'ledna', 'února', 'března', 'dubna', 'května', 'června',
      'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
    );
    // Czech and Slovak medium dates are numeric and space the parts out.
    assert.equal(parseTimestamp('21. 5. 2025'), local(2025, 5, 21));
  });

  it('reads Slovak and Slovenian', () => {
    readsYear(
      'januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
      'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra',
    );
    readsYear(
      'januar', 'februar', 'marec', 'april', 'maj', 'junij',
      'julij', 'avgust', 'september', 'oktober', 'november', 'december',
    );
  });

  it('reads Turkish, dotless i and all', () => {
    readsYear('Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara');
    readsYear(
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    );
  });

  it('reads Romanian, Indonesian, Malay and Catalan', () => {
    readsYear(
      'ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.',
      'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.',
    );
    readsYear('Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des');
    readsYear(
      'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
      'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember',
    );
    readsYear(
      'gen.', 'febr.', 'març', 'abr.', 'maig', 'juny',
      'jul.', 'ag.', 'set.', 'oct.', 'nov.', 'des.',
    );
    // Catalan puts a connector on both sides, and elides it before a vowel.
    assert.equal(parseTimestamp('21 de maig del 2025'), local(2025, 5, 21));
    assert.equal(parseTimestamp("21 d'abril del 2025"), local(2025, 4, 21));
  });

  it('still reads the British four-letter September', () => {
    assert.equal(parseTimestamp('21 Sept 2025, 20:44'), local(2025, 9, 21, 20, 44));
  });
});

describe('parseTimestamp: month names that mean two months', () => {
  it('does not read Finnish marras as March', () => {
    // `marras` is November and begins with the three letters fourteen other
    // languages spell March with. Reading it by prefix would file every
    // Finnish November session in March without saying so, so `mar` is matched
    // as a whole word and never as a prefix.
    assert.equal(parseTimestamp('21 marras 2025, 20:44'), local(2025, 11, 21, 20, 44));
    assert.equal(parseTimestamp('21 marrask. 2025'), local(2025, 11, 21));
    assert.equal(parseTimestamp('21 marraskuuta 2025'), local(2025, 11, 21));
    assert.equal(parseTimestamp('21 maalis 2025'), local(2025, 3, 21));
    assert.equal(parseTimestamp('21 mar 2025'), local(2025, 3, 21));
    assert.equal(parseTimestamp('21 mars 2025'), local(2025, 3, 21));
  });

  it('reads the whole Finnish year', () => {
    const names = [
      'tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä',
      'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu',
    ];
    names.forEach((name, index) => {
      assert.equal(parseTimestamp(`21 ${name}kuuta 2025`), local(2025, index + 1, 21), name);
    });
  });

  it('separates French juin from juillet', () => {
    // Three letters cannot: French abbreviates to `juil.` for exactly this
    // reason. So `jui` is not a prefix, and a word starting with it that is not
    // one of the four spellings below is refused instead of guessed at.
    assert.equal(parseTimestamp('21 juin 2025'), local(2025, 6, 21));
    assert.equal(parseTimestamp('21 juil. 2025'), local(2025, 7, 21));
    assert.equal(parseTimestamp('21 juillet 2025'), local(2025, 7, 21));
    assert.equal(parseTimestamp('21 juix 2025'), null);
  });

  it('separates Czech června from července', () => {
    assert.equal(parseTimestamp('21. června 2025'), local(2025, 6, 21));
    assert.equal(parseTimestamp('21. července 2025'), local(2025, 7, 21));
    assert.equal(parseTimestamp('21. čvn 2025'), local(2025, 6, 21));
    assert.equal(parseTimestamp('21. čvc 2025'), local(2025, 7, 21));
  });

  it('resolves listopad the Polish and Czech way, not the Croatian one', () => {
    // `listopad` is November in Polish and Czech and October in Croatian, and
    // `lip` and `srp` slide by a month the same way. Nothing in a CSV says
    // which language wrote it, so one reading has to win: Polish and Czech,
    // on population. Croatian exports are the documented casualty, which is
    // why Croatian is deliberately absent from the tables.
    assert.equal(parseTimestamp('21 listopada 2025'), local(2025, 11, 21));
    assert.equal(parseTimestamp('21. listopadu 2025'), local(2025, 11, 21));
    assert.equal(parseTimestamp('21 lip 2025'), local(2025, 7, 21));
    assert.equal(parseTimestamp('21 srp 2025'), local(2025, 8, 21));
  });

  it('refuses a date shape it cannot read rather than inventing one', () => {
    // Hungarian and Latvian put the year first, and Russian needs a genitive
    // stem and a trailing era marker. All three are out of scope here, and the
    // point of these cases is that being out of scope means null, which the
    // import screen counts, rather than a plausible wrong day.
    assert.equal(parseTimestamp('2025. máj. 21.'), null);
    assert.equal(parseTimestamp('2025. gada 21. maijs'), null);
    assert.equal(parseTimestamp('21 мая 2025'), null);
    assert.equal(parseTimestamp('21 lipanj 2025, 20:44'), local(2025, 7, 21, 20, 44));
  });

  it('matches every month name the platform can produce for a supported locale', () => {
    // The tables were generated from CLDR, so this re-derives them at run time
    // and is the case that fails if a future ICU renames a month. It needs the
    // full data set: a Node built with small-icu formats everything as English,
    // which would make the sweep pass for the wrong reason.
    const locales = [
      'en', 'en-GB', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'sv', 'da', 'nb',
      'fi', 'pl', 'cs', 'sk', 'sl', 'tr', 'ro', 'id', 'ms', 'ca',
    ];
    const november = new Date(2025, 10, 21);
    if (new Intl.DateTimeFormat('fi', { month: 'short' }).format(november) === 'Nov') return;

    for (const locale of locales) {
      for (let month = 0; month < 12; month += 1) {
        const day = new Date(2025, month, 21);
        for (const width of ['short', 'long'] as const) {
          const name = new Intl.DateTimeFormat(locale, { month: width }).format(day);
          assert.equal(
            parseTimestamp(`21 ${name} 2025, 20:44`),
            local(2025, month + 1, 21, 20, 44),
            `${locale} ${width} ${name}`,
          );
        }
        for (const style of [
          { day: 'numeric', month: 'short', year: 'numeric' },
          { day: 'numeric', month: 'long', year: 'numeric' },
        ] as const) {
          const written = new Intl.DateTimeFormat(locale, style).format(day);
          assert.equal(parseTimestamp(written), local(2025, month + 1, 21), `${locale} ${written}`);
        }
      }
    }
  });
});

describe('detectDateOrder', () => {
  it('takes one unambiguous row as evidence for the column', () => {
    assert.equal(detectDateOrder(['01/02/2025', '21/05/2025']), 'dmy');
    assert.equal(detectDateOrder(['01/02/2025', '05/21/2025']), 'mdy');
  });

  it('falls back to day-first when nothing settles it', () => {
    assert.equal(detectDateOrder(['01/02/2025', '03/04/2025']), 'dmy');
    assert.equal(detectDateOrder([]), 'dmy');
  });
});

describe('parseSetType', () => {
  it('maps the four Lift stores exactly', () => {
    assert.deepEqual(parseSetType('warmup'), { type: 'warmup', exact: true });
    assert.deepEqual(parseSetType('Warm Up'), { type: 'warmup', exact: true });
    assert.deepEqual(parseSetType('dropset'), { type: 'drop', exact: true });
    assert.deepEqual(parseSetType('failure'), { type: 'failure', exact: true });
    assert.deepEqual(parseSetType('normal'), { type: 'normal', exact: true });
    assert.deepEqual(parseSetType(''), { type: 'normal', exact: true });
  });

  it('flags the ones it had to flatten', () => {
    assert.deepEqual(parseSetType('amrap'), { type: 'normal', exact: false });
    assert.deepEqual(parseSetType('myoreps'), { type: 'normal', exact: false });
  });
});

describe('parseSetType: localised words', () => {
  const warmup = { type: 'warmup', exact: true };
  const drop = { type: 'drop', exact: true };
  const failure = { type: 'failure', exact: true };
  const normal = { type: 'normal', exact: true };

  it('reads the warm-up word in every language the month tables cover', () => {
    for (const word of [
      'Calentamiento', 'Aquecimento', 'Échauffement', 'Aufwärmen', 'Riscaldamento',
      'Opwarmen', 'Warming-up', 'Uppvärmning', 'Opvarmning', 'Oppvarming',
      'Lämmittely', 'Rozgrzewka', 'Zahřívací série', 'Rozcvička', 'Ogrevanje',
      'Isınma', 'Încălzire', 'Pemanasan', 'Escalfament',
    ]) {
      assert.deepEqual(parseSetType(word), warmup, word);
    }
  });

  it('reads translated drop sets and failure sets', () => {
    for (const word of ['Dropsatz', 'Dropsæt', 'Serie descendente', 'Série dégressive', 'Reduktionssatz']) {
      assert.deepEqual(parseSetType(word), drop, word);
    }
    for (const word of [
      'Fallo', 'Al fallo', 'Falha', 'Échec', 'Muskelversagen', 'Cedimento', 'Falen', 'Do upadku',
    ]) {
      assert.deepEqual(parseSetType(word), failure, word);
    }
  });

  it('reads a translated working set as an ordinary one', () => {
    for (const word of [
      'Normale', 'Normaal', 'Serie normal', 'Arbeitssatz', 'Arbetsset', 'Arbejdssæt',
      'Arbeidssett', 'Série de travail', 'Serie di lavoro', 'Série de trabalho',
      'Serie de trabajo', 'Werkset', 'Seria robocza', 'Pracovní série', 'Çalışma seti',
      'Set kerja', 'Serie', 'Série',
    ]) {
      assert.deepEqual(parseSetType(word), normal, word);
    }
  });

  it('does not let the word for "set" inside a warm-up label win', () => {
    // `Aufwärmsatz` and `serie de calentamiento` both contain the ordinary word
    // for a set, and a warm-up read as a working set inflates volume, PRs and
    // every 1RM estimate downstream. Hence warm-up is matched first.
    assert.deepEqual(parseSetType('Aufwärmsatz'), warmup);
    assert.deepEqual(parseSetType('Serie de calentamiento'), warmup);
    assert.deepEqual(parseSetType('Série d’échauffement'), warmup);
    assert.deepEqual(parseSetType('Serie di riscaldamento'), warmup);
  });

  it('keeps an accented word from losing the letter under the accent', () => {
    // The old fold deleted anything outside a-z, so `Aufwärmen` arrived as
    // `aufwrmen` and matched nothing at all.
    assert.deepEqual(parseSetType('AUFWÄRMEN'), warmup);
    assert.deepEqual(parseSetType('ısınma'), warmup);
  });

  it('still flattens a word no language on the list claims', () => {
    assert.deepEqual(parseSetType('kalibrointi'), { type: 'normal', exact: false });
  });
});

// ---------------------------------------------------------------------------
// Whole files
// ---------------------------------------------------------------------------

describe('parseWorkoutCsv: Hevy', () => {
  const parsed = parseWorkoutCsv(HEVY_CSV);

  it('rebuilds the sessions in chronological order', () => {
    assert.equal(parsed.source, 'hevy');
    assert.equal(parsed.workouts.length, 2);
    assert.deepEqual(
      parsed.workouts.map((workout) => workout.name),
      ['upper 1', 'legs'],
    );
  });

  it('nests exercises and sets under the right session', () => {
    const legs = parsed.workouts[1]!;

    assert.equal(legs.startedAt, local(2025, 5, 21, 20, 44));
    assert.equal(legs.finishedAt, local(2025, 5, 21, 22, 3));
    assert.equal(legs.durationSeconds, 79 * 60);
    assert.equal(legs.notes, 'felt strong');
    assert.deepEqual(
      legs.exercises.map((exercise) => exercise.name),
      ['Seated Leg Curl (Machine)', 'Leg Extension (Machine)'],
    );
    assert.deepEqual(legs.exercises[0]!.sets, [
      { setType: 'warmup', weightKg: 52, reps: 5, durationSeconds: null, distanceKm: null, rpe: null },
      { setType: 'normal', weightKg: 60, reps: 5, durationSeconds: null, distanceKm: null, rpe: null },
    ]);
  });

  it('keeps the per-exercise notes and RPE', () => {
    const extension = parsed.workouts[1]!.exercises[1]!;

    assert.equal(extension.notes, 'slow negatives');
    assert.equal(extension.sets[0]!.rpe, 8);
    assert.equal(extension.sets[1]!.setType, 'failure');
  });

  it('counts what it read', () => {
    assert.equal(parsed.diagnostics.totalRows, 6);
    assert.equal(parsed.diagnostics.undatedRows, 0);
    assert.equal(parsed.diagnostics.blankRows, 0);
    assert.equal(parsed.diagnostics.weightUnitSource, 'header');
    assert.equal(countSets(parsed.workouts), 6);
  });
});

describe('parseWorkoutCsv: Lift', () => {
  const parsed = parseWorkoutCsv(LIFT_CSV);

  it("reads the app's own export", () => {
    assert.equal(parsed.source, 'lift');
    assert.equal(parsed.workouts.length, 1);

    const workout = parsed.workouts[0]!;
    assert.equal(workout.name, 'Push day');
    assert.equal(workout.startedAt, Date.UTC(2026, 7, 18, 17, 30));
    assert.deepEqual(
      workout.exercises.map((exercise) => exercise.name),
      ['Bench Press (Barbell)', 'Plank'],
    );
  });

  it('reads a duration-only set without inventing a weight', () => {
    const plank = parsed.workouts[0]!.exercises[1]!.sets[0]!;

    assert.equal(plank.durationSeconds, 90);
    assert.equal(plank.weightKg, null);
    assert.equal(plank.reps, null);
  });

  it('estimates a session length the file does not give', () => {
    const workout = parsed.workouts[0]!;

    // Three sets at 2.5 minutes each. The export has no end time and no
    // duration column, so this is `resolveEnd`'s last resort: see the note
    // there for why a length is estimated where a weight never is.
    assert.equal(workout.durationSeconds, 3 * 150);
    // Never null: a null finish is what marks the *active* session, and an
    // import must not reopen a workout from two years ago. It now lands the
    // estimate past the start rather than exactly on it.
    assert.equal(workout.finishedAt, workout.startedAt + 3 * 150 * 1000);
  });

  it('drops a session whose only row performed nothing', () => {
    /*
     * Which is why `resolveEnd`'s null is a guard rather than a state.
     *
     * A workout draft is only created by a row that recorded something, so
     * every draft reaching `resolveEnd` has at least one set and the set-count
     * estimate always has something to count. A file whose only row is blank
     * produces no workout at all rather than a workout of unknown length,
     * which is the case this pins.
     */
    const empty = parseWorkoutCsv(
      'Date,Workout,Exercise,Set Type,Weight (kg),Reps,Duration (s),Distance (km),RPE\n' +
        '2026-08-18T17:30:00.000Z,Push day,Bench Press (Barbell),normal,,,,,',
    );

    assert.equal(empty.workouts.length, 0);
    assert.equal(empty.diagnostics.blankRows, 1);
  });
});

describe('parseWorkoutCsv: units', () => {
  it('converts a pounds column to kilograms', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight (lbs),Reps\n2025-05-21,Squat,225,5',
    );

    assert.equal(parsed.diagnostics.weightUnit, 'lb');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.0583);
  });

  it('lets the header override what the user picked', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,weight_kg,Reps\n2025-05-21,Squat,100,5', {
      weightUnit: 'lb',
    });

    assert.equal(parsed.diagnostics.weightUnitSource, 'header');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 100);
  });

  it('uses the chosen unit when the file names none', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,Weight,Reps\n2025-05-21,Squat,225,5', {
      weightUnit: 'lb',
    });

    assert.equal(parsed.diagnostics.weightUnitSource, 'chosen');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.0583);
  });

  it('reads a per-row unit column', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Unit,Reps\n2025-05-21,Squat,100,kg,5\n2025-05-21,Bench,225,lbs,5',
    );

    assert.equal(parsed.diagnostics.weightUnitSource, 'column');
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 100);
    assert.equal(parsed.workouts[0]!.exercises[1]!.sets[0]!.weightKg, 102.0583);
  });

  it('converts miles to kilometres', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Distance (mi),Duration\n2025-05-21,Running,3,1800',
    );

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.distanceKm, 4.82803);
  });
});

describe('parseWorkoutCsv: European exports', () => {
  it('reads a Hevy export written by a phone that is not in English', () => {
    // Hevy's headers are machine names and stay put; the dates and set types
    // are what the phone's locale rewrites. This is the whole reason the export
    // guide no longer asks people to switch the app to English first.
    const parsed = parseWorkoutCsv(
      `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Beine","21. Mär 2025, 20:44","21. Mär 2025, 22:03","","Beinbeuger (Maschine)",,"",0,"Aufwärmsatz",52,5,,,
"Beine","21. Mär 2025, 20:44","21. Mär 2025, 22:03","","Beinbeuger (Maschine)",,"",1,"Arbeitssatz",60,5,,,`,
    );

    assert.equal(parsed.source, 'hevy');
    assert.equal(parsed.diagnostics.undatedRows, 0);

    const workout = parsed.workouts[0]!;
    assert.equal(workout.startedAt, local(2025, 3, 21, 20, 44));
    assert.deepEqual(
      workout.exercises[0]!.sets.map((set) => set.setType),
      ['warmup', 'normal'],
    );
  });

  it('refuses translated headers in a sentence rather than importing nothing', () => {
    // Month names and set types are read in twenty-one languages now, but the
    // column headings are still matched against English aliases, which is the
    // one thing the export guide still has to warn about. What matters is that
    // the refusal names the missing column instead of producing an empty import
    // the user would read as "my file was fine and Lift lost it".
    assert.throws(
      () => parseWorkoutCsv('Datum;Übung;Gewicht (kg);Wiederholungen\n21.05.2025;Kniebeuge;102,5;5'),
      (error: Error) =>
        error instanceof ImportFormatError && /exercise column/i.test(error.message),
    );
  });

  it('reads comma decimals when the headers are recognisable', () => {
    const parsed = parseWorkoutCsv(
      'Date;Exercise;Weight;Reps\n21.05.2025;Squat;102,5;5',
    );

    assert.equal(parsed.workouts[0]!.startedAt, local(2025, 5, 21));
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.weightKg, 102.5);
  });
});

describe('parseWorkoutCsv: effort', () => {
  it('reads reps-in-reserve as the RPE it means', () => {
    const parsed = parseWorkoutCsv('Date,Exercise,Weight,Reps,RIR\n2025-05-21,Squat,100,5,2');

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.rpe, 8);
  });

  it('prefers an RPE column when the file has both', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps,RPE,RIR\n2025-05-21,Squat,100,5,9.5,2',
    );

    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.rpe, 9.5);
  });
});

describe('parseWorkoutCsv: supersets', () => {
  const csv = [
    'start_time,title,exercise_title,superset_id,weight_kg,reps',
    '2025-05-21 10:00,Pull,Row,1,80,8',
    '2025-05-21 10:00,Pull,Curl,1,20,10',
    '2025-05-21 10:00,Pull,Shrug,2,100,12',
  ].join('\n');

  it('numbers groups shared by two or more exercises', () => {
    const [workout] = parseWorkoutCsv(csv).workouts;

    assert.equal(workout!.exercises[0]!.supersetGroup, 0);
    assert.equal(workout!.exercises[1]!.supersetGroup, 0);
  });

  it('leaves a group of one alone', () => {
    const [workout] = parseWorkoutCsv(csv).workouts;
    assert.equal(workout!.exercises[2]!.supersetGroup, null);
  });
});

describe('parseWorkoutCsv: rows it cannot use', () => {
  it('skips undated rows and says how many', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps\n2025-05-21,Squat,100,5\nsometime,Squat,100,5',
    );

    assert.equal(parsed.diagnostics.undatedRows, 1);
    assert.equal(countSets(parsed.workouts), 1);
  });

  it('skips rows that record nothing performed', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Weight,Reps\n2025-05-21,Squat,100,5\n2025-05-21,Squat,,',
    );

    assert.equal(parsed.diagnostics.blankRows, 1);
    assert.equal(countSets(parsed.workouts), 1);
  });

  it('tallies set types it had to flatten', () => {
    const parsed = parseWorkoutCsv(
      'Date,Exercise,Set Type,Weight,Reps\n2025-05-21,Squat,amrap,100,15',
    );

    assert.deepEqual(parsed.diagnostics.coercedSetTypes, { amrap: 1 });
    assert.equal(parsed.workouts[0]!.exercises[0]!.sets[0]!.setType, 'normal');
  });

  it('refuses a file with no exercise column, by name', () => {
    assert.throws(
      () => parseWorkoutCsv('Date,Weight,Reps\n2025-05-21,100,5'),
      (error: Error) =>
        error instanceof ImportFormatError && /exercise column/i.test(error.message),
    );
  });

  it('refuses a file with no date column, by name', () => {
    assert.throws(
      () => parseWorkoutCsv('Exercise,Weight,Reps\nSquat,100,5'),
      (error: Error) => error instanceof ImportFormatError && /date column/i.test(error.message),
    );
  });

  it('refuses an empty file', () => {
    assert.throws(() => parseWorkoutCsv(''), ImportFormatError);
  });
});

describe('parseWorkoutCsv: ordering', () => {
  it('puts sets back in index order when a spreadsheet has been re-sorted', () => {
    const parsed = parseWorkoutCsv(
      [
        'start_time,exercise_title,set_index,set_type,weight_kg,reps',
        '2025-05-21 10:00,Squat,1,normal,100,5',
        '2025-05-21 10:00,Squat,0,warmup,60,5',
      ].join('\n'),
    );

    assert.deepEqual(
      parsed.workouts[0]!.exercises[0]!.sets.map((set) => set.setType),
      ['warmup', 'normal'],
    );
  });

  it('gathers an exercise returned to later in the session', () => {
    const parsed = parseWorkoutCsv(
      [
        'start_time,exercise_title,weight_kg,reps',
        '2025-05-21 10:00,Squat,100,5',
        '2025-05-21 10:00,Bench,80,5',
        '2025-05-21 10:00,Squat,110,3',
      ].join('\n'),
    );

    const [squat, bench] = parsed.workouts[0]!.exercises;
    assert.equal(squat!.sets.length, 2);
    assert.equal(bench!.sets.length, 1);
  });
});

// ---------------------------------------------------------------------------
// How far back
// ---------------------------------------------------------------------------

describe('importCutoff', () => {
  const now = new Date(2026, 7, 20, 14, 0);

  it('counts calendar days including today', () => {
    assert.equal(importCutoff('7d', now), local(2026, 8, 14));
    assert.equal(importCutoff('30d', now), local(2026, 7, 22));
  });

  it('has no cutoff for everything', () => {
    assert.equal(importCutoff('all', now), null);
  });

  it('keeps a session logged earlier today', () => {
    const cutoff = importCutoff('7d', now)!;
    assert.ok(local(2026, 8, 20, 6, 30) >= cutoff);
  });
});

describe('filterWorkoutsSince', () => {
  const workouts = [
    { startedAt: local(2026, 1, 1), exercises: [] },
    { startedAt: local(2026, 8, 19), exercises: [] },
  ] as never as Parameters<typeof filterWorkoutsSince>[0];

  it('drops everything before the cutoff', () => {
    const kept = filterWorkoutsSince(workouts, local(2026, 8, 14));
    assert.equal(kept.length, 1);
  });

  it('keeps everything when there is no cutoff', () => {
    assert.equal(filterWorkoutsSince(workouts, null).length, 2);
  });
});

describe('importing only a recent slice', () => {
  // Four sessions spread across a year, written the way Hevy writes them.
  const csv = [
    'title,start_time,exercise_title,set_index,set_type,weight_kg,reps',
    'legs,15 Aug 2026 10:00,Squat,0,normal,140,5',
    'push,10 Aug 2026 10:00,Bench Press,0,normal,100,5',
    'pull,01 Jul 2026 10:00,Deadlift,0,normal,180,3',
    'legs,03 Feb 2026 10:00,Squat,0,normal,120,5',
  ].join('\n');

  const parsed = parseWorkoutCsv(csv);
  const now = new Date(2026, 7, 16, 9, 0);

  it('keeps only the sessions inside the window', () => {
    const kept = filterWorkoutsSince(parsed.workouts, importCutoff('7d', now));

    assert.deepEqual(
      kept.map((workout) => workout.name),
      ['push', 'legs'],
    );
    assert.equal(countSets(kept), 2);
  });

  it('widens with the window', () => {
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('30d', now)).length, 2);
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('3m', now)).length, 3);
    assert.equal(filterWorkoutsSince(parsed.workouts, importCutoff('all', now)).length, 4);
  });

  it('narrows the exercises the import would need along with the dates', () => {
    const week = filterWorkoutsSince(parsed.workouts, importCutoff('7d', now));

    // Deadlift is only in the July session, so importing last week must not
    // drag it into the library.
    assert.deepEqual(collectExerciseNames(week).sort(), ['Bench Press', 'Squat']);
  });
});

describe('collectExerciseNames', () => {
  it('lists each name once, in the order it first appears', () => {
    const parsed = parseWorkoutCsv(HEVY_CSV);

    assert.deepEqual(collectExerciseNames(parsed.workouts), [
      'Incline Bench Press (Dumbbell)',
      'Lat Pulldown (Cable)',
      'Seated Leg Curl (Machine)',
      'Leg Extension (Machine)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

describe('exerciseMatchKey', () => {
  it('collapses word order, punctuation and plurals', () => {
    assert.equal(exerciseMatchKey('Bench Press (Barbell)'), exerciseMatchKey('Barbell Bench Press'));
    assert.equal(exerciseMatchKey('Bent-Over Row'), exerciseMatchKey('Bent Over Row'));
    assert.equal(exerciseMatchKey('Push Ups'), exerciseMatchKey('Push Up'));
  });

  it('keeps genuinely different lifts apart', () => {
    assert.notEqual(exerciseMatchKey('Front Squat'), exerciseMatchKey('Back Squat'));
    assert.notEqual(exerciseMatchKey('Bench Press (Barbell)'), exerciseMatchKey('Bench Press (Dumbbell)'));
  });

  it('leaves double-s words alone', () => {
    assert.equal(exerciseMatchKey('Press'), 'press');
    assert.equal(exerciseMatchKey('Cable Cross'), 'cable cross');
  });
});

describe('inferEquipment', () => {
  it('reads the parenthetical every app appends', () => {
    assert.equal(inferEquipment('Bench Press (Barbell)'), 'barbell');
    assert.equal(inferEquipment('Lat Pulldown (Cable)'), 'cable');
    assert.equal(inferEquipment('Row (Smith Machine)'), 'smith_machine');
    assert.equal(inferEquipment('Pull Up'), 'other');
  });

  it('prefers the longer match', () => {
    assert.equal(inferEquipment('Smith Machine Row'), 'smith_machine');
  });

  it('reads Gymvisual machine prefixes', () => {
    assert.equal(inferEquipment('Lever Seated Calf Raise'), 'machine');
    assert.equal(inferEquipment('Sled Hack Squat'), 'machine');
  });
});

describe('matchImportedName', () => {
  const library = buildImportMatchIndex([
    { id: 'bench-press', name: 'Bench Press', equipment: 'barbell' },
    { id: 'incline-bench-press', name: 'Incline Bench Press', equipment: 'dumbbell' },
    { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', equipment: 'dumbbell' },
    { id: 'bulgarian-split-squat-bw', name: 'Bulgarian Split Squat', equipment: 'bodyweight' },
    { id: 'seated-calf-raise', name: 'Seated Calf Raise', equipment: 'machine' },
    { id: 'seated-shoulder-press', name: 'Seated Shoulder Press', equipment: 'dumbbell' },
    { id: 'triceps-pressdown', name: 'Triceps Pressdown', equipment: 'machine' },
    { id: 'front-squat', name: 'Front Squat', equipment: 'barbell' },
    { id: 'squat', name: 'Squat', equipment: 'barbell' },
  ]);

  const kind = (name: string) => matchImportedName(name, library);

  it('still matches word order and parenthetical equipment', () => {
    const hit = kind('Bench Press (Barbell)');
    assert.equal(hit.kind, 'hit');
    if (hit.kind === 'hit') assert.equal(hit.id, 'bench-press');
  });

  it('links a Lyfta equipment prefix when the catalog dropped it', () => {
    const hit = kind('Dumbbell Incline Bench Press');
    assert.equal(hit.kind, 'hit');
    if (hit.kind === 'hit') assert.equal(hit.id, 'incline-bench-press');
  });

  it('keeps equipment when two catalog rows share the stripped name', () => {
    const hit = kind('Dumbbell Bulgarian Split Squat');
    assert.equal(hit.kind, 'hit');
    if (hit.kind === 'hit') assert.equal(hit.id, 'bulgarian-split-squat');
  });

  it('maps a lever prefix onto the machine catalog row', () => {
    const hit = kind('Lever Seated Calf Raise');
    assert.equal(hit.kind, 'hit');
    if (hit.kind === 'hit') assert.equal(hit.id, 'seated-calf-raise');
  });

  it('does not silently file a machine press under a dumbbell one', () => {
    const decision = kind('Lever Seated Shoulder Press');
    assert.notEqual(decision.kind, 'hit');
    if (decision.kind === 'ask') {
      assert.ok(decision.suggestions.some((row) => row.id === 'seated-shoulder-press'));
    }
  });

  it('offers a pushdown against a pressdown rather than inventing a custom row', () => {
    const decision = kind('Cable Pushdown');
    assert.notEqual(decision.kind, 'miss');
    if (decision.kind === 'ask') {
      assert.ok(decision.suggestions.some((row) => row.id === 'triceps-pressdown'));
    }
    if (decision.kind === 'hit') assert.equal(decision.id, 'triceps-pressdown');
  });

  it('does not collapse a front squat into a squat', () => {
    const hit = kind('Front Squat (Barbell)');
    assert.equal(hit.kind, 'hit');
    if (hit.kind === 'hit') assert.equal(hit.id, 'front-squat');
  });

  it('misses a name the library does not have', () => {
    assert.equal(kind('Jefferson Curl').kind, 'miss');
  });
});

describe('inferMuscles', () => {
  const primary = (name: string) => inferMuscles(name).primary;

  it('reads the movement, not the equipment', () => {
    assert.equal(primary('Bench Press (Barbell)'), 'chest');
    assert.equal(primary('Lat Pulldown (Cable)'), 'lats');
    assert.equal(primary('Lateral Raise (Dumbbell)'), 'shoulders');
    assert.equal(primary('Hip Thrust (Machine)'), 'glutes');
  });

  it('carries the secondaries the catalog gives the same movement', () => {
    assert.deepEqual(inferMuscles('Bench Press').secondary, ['shoulders', 'triceps']);
    assert.deepEqual(inferMuscles('Calf Raise').secondary, []);
  });

  // The whole reason MUSCLE_WORDS is ordered longest phrase first.
  it('lets the longer phrase win', () => {
    assert.equal(primary('Leg Curl'), 'hamstrings');
    assert.equal(primary('Barbell Curl'), 'biceps');
    assert.equal(primary('Wrist Curl'), 'forearms');
    assert.equal(primary('Upright Row'), 'shoulders');
    assert.equal(primary('Bent Over Row'), 'upper_back');
    assert.equal(primary('Rowing Machine'), 'cardio');
    assert.equal(primary('Bulgarian Split Squat'), 'quads');
    assert.equal(primary('Back Squat'), 'glutes');
    assert.equal(primary('Close-Grip Bench Press'), 'triceps');
  });

  it('takes the plural spelling an exporter writes', () => {
    assert.equal(primary('Push Ups'), 'chest');
    assert.equal(primary('Squats'), 'glutes');
    assert.equal(primary('Crunches'), 'abs');
    assert.equal(primary('Lunges'), 'quads');
    assert.equal(primary('Calf Raises'), 'calves');
  });

  // Substring matching would file this under the upper back: "throw" ends "row".
  it('matches whole words only', () => {
    assert.equal(primary('Medicine Ball Throw'), 'other');
  });

  it('keeps other for a name that does not say', () => {
    assert.equal(primary('Jefferson'), 'other');
    assert.equal(primary('Cable Fly'), 'other');
    assert.equal(primary('Turkish Get Up'), 'other');
  });
});

describe('inferTrackingType', () => {
  const set = (values: Partial<Parameters<typeof inferTrackingType>[1][number]>) => ({
    setType: 'normal' as const,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceKm: null,
    rpe: null,
    ...values,
  });

  it('reads a loaded rep exercise', () => {
    assert.equal(inferTrackingType('Squat', [set({ weightKg: 100, reps: 5 })]), 'weight_reps');
  });

  it('reads a weight column of zeroes as bodyweight', () => {
    assert.equal(inferTrackingType('Push Up', [set({ weightKg: 0, reps: 20 })]), 'bodyweight_reps');
  });

  it('claims no volume when there is no weight column at all', () => {
    assert.equal(inferTrackingType('Push Up', [set({ reps: 20 })]), 'reps_only');
  });

  it('reads holds and runs', () => {
    assert.equal(inferTrackingType('Plank', [set({ durationSeconds: 90 })]), 'duration');
    assert.equal(
      inferTrackingType('Running', [set({ distanceKm: 5, durationSeconds: 1800 })]),
      'distance_duration',
    );
  });

  it('takes the name at its word on assisted and weighted variants', () => {
    assert.equal(
      inferTrackingType('Pull Up (Assisted)', [set({ weightKg: 20, reps: 8 })]),
      'assisted_bodyweight',
    );
    assert.equal(
      inferTrackingType('Chin Up (Weighted)', [set({ weightKg: 20, reps: 8 })]),
      'weighted_bodyweight',
    );
  });
});

// ---------------------------------------------------------------------------
// Routines inferred from session titles
// ---------------------------------------------------------------------------

describe('identifyRoutines', () => {
  it('keeps a title that appears once', () => {
    const parsed = parseWorkoutCsv(HEVY_CSV);
    const identified = identifyRoutines(parsed.workouts);

    assert.deepEqual(
      identified.map((routine) => ({ name: routine.name, sessionCount: routine.sessionCount })),
      [
        { name: 'upper 1', sessionCount: 1 },
        { name: 'legs', sessionCount: 1 },
      ],
    );
  });

  it('uses the latest session when a Hevy title repeats', () => {
    const parsed = parseWorkoutCsv(
      [
        'title,start_time,exercise_title,set_index,set_type,weight_kg,reps',
        'Push,10 Aug 2026 10:00,Bench Press,0,normal,80,5',
        'Push,10 Aug 2026 10:00,Overhead Press,0,normal,40,8',
        'Push,22 Aug 2026 10:00,Bench Press,0,normal,90,5',
        'Push,22 Aug 2026 10:00,Fly,0,normal,12,10',
        'Pull,11 Aug 2026 10:00,Row,0,normal,70,8',
      ].join('\n'),
    );

    const identified = identifyRoutines(parsed.workouts);

    assert.equal(identified.length, 2);
    assert.equal(identified[0]!.name, 'Push');
    assert.equal(identified[0]!.sessionCount, 2);
    assert.deepEqual(
      identified[0]!.latest.exercises.map((exercise) => exercise.name),
      ['Bench Press', 'Fly'],
    );
    assert.equal(identified[1]!.name, 'Pull');
    assert.equal(identified[1]!.sessionCount, 1);
  });

  it('skips untitled sessions', () => {
    const parsed = parseWorkoutCsv(
      'start_time,exercise_title,weight_kg,reps\n2026-08-10 10:00,Squat,100,5',
    );

    assert.equal(parsed.workouts[0]!.name, '');
    assert.deepEqual(identifyRoutines(parsed.workouts), []);
  });

  it('treats Push and push as one routine, named as the latest spelled it', () => {
    const parsed = parseWorkoutCsv(
      [
        'title,start_time,exercise_title,weight_kg,reps',
        'push,10 Aug 2026 10:00,Bench Press,80,5',
        'Push,22 Aug 2026 10:00,Bench Press,90,5',
      ].join('\n'),
    );

    const [routine] = identifyRoutines(parsed.workouts);
    assert.equal(routine!.name, 'Push');
    assert.equal(routine!.sessionCount, 2);
  });

  it('reads a Lyfta-shaped header, including a leading space on Title', () => {
    const parsed = parseWorkoutCsv(
      [
        ' Title,Date,Duration,Exercise,"Superset id",Weight,Reps,Distance,Time,"Set Type"',
        'Upper,"2026-08-29 12:34:55",00:38:37,"Dumbbell Incline Bench Press",,14.000,10,,,NORMAL_SET',
        'lower,"2026-08-24 14:16:06",02:19:14,"Barbell Squat",,20.000,10,,,NORMAL_SET',
        'Pull,"2026-08-06 15:09:52",00:48:52,"Assisted Pull-up",,27.200,10,,,NORMAL_SET',
        'Pull,"2026-08-11 15:16:03",00:48:52,"Bent Over Row",,10.000,10,,,NORMAL_SET',
      ].join('\n'),
    );

    const identified = identifyRoutines(parsed.workouts);
    assert.deepEqual(
      identified.map((routine) => ({
        name: routine.name,
        sessionCount: routine.sessionCount,
        latestExercise: routine.latest.exercises[0]!.name,
      })),
      [
        { name: 'Pull', sessionCount: 2, latestExercise: 'Bent Over Row' },
        { name: 'lower', sessionCount: 1, latestExercise: 'Barbell Squat' },
        { name: 'Upper', sessionCount: 1, latestExercise: 'Dumbbell Incline Bench Press' },
      ],
    );
  });

  it('reads Strong workout names', () => {
    const parsed = parseWorkoutCsv(
      [
        'Date,Workout Name,Exercise Name,Set Order,Weight,Reps',
        '2026-08-10,Push,Bench Press,1,80,5',
        '2026-08-11,Pull,Lat Pulldown,1,50,8',
      ].join('\n'),
    );

    assert.deepEqual(
      identifyRoutines(parsed.workouts).map((routine) => routine.name),
      ['Push', 'Pull'],
    );
  });

  it('reads Lift CSV workout names', () => {
    const identified = identifyRoutines(parseWorkoutCsv(LIFT_CSV).workouts);
    assert.deepEqual(
      identified.map((routine) => routine.name),
      ['Push day'],
    );
  });
});
