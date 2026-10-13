Feature: Writing down the language that was spoken
  Blab told Whisper every recording was English, because transformers.js
  cannot detect a language and quietly assumes English when none is named.
  Whisper does as it is told. On Croatian it writes English anyway: not a
  transcript, and not an honest translation either, but English that reads
  smoothly and invents what it could not carry over. One call that switched to
  Croatian halfway came back with people in it swapped for other people, and
  sentences nobody said.

  Whisper can still say what it hears. Before transcribing, Blab asks it about
  every 30 seconds of speech, the way Whisper's own detect_language does, and
  writes each stretch in the language it was spoken in. A call that moves
  between English and Croatian comes back in both.

  Leaving English is the dangerous direction. English transcribed as Croatian
  is not a translation, it is a loop of "ti ki pi", which is why the language
  picker was removed in 0.5.0. So the bar to leave English is high: Whisper
  has to be nearly certain, and the thresholds are held to its real guesses on
  real recordings in tests/language.spec.ts. Short or quiet English that
  Whisper is unsure about stays English, as it always did.

  Live captions are a preview and stay English.

  Scenario: A call that switches languages is written in both
    Given a 37 minute call in English, then Croatian, then English, then Croatian
    When it is transcribed
    Then the Croatian stretches are written in Croatian
    And the English stretches are written in English

  Scenario: An English talk is untouched
    Given a recording in English
    When it is transcribed
    Then it is one stretch, in English, exactly as before

  Scenario: English Whisper is unsure about stays English
    Given eight seconds of English that Whisper thinks may be Latin
    Or a muttered English start that Whisper thinks may be Croatian
    When it is transcribed
    Then it is written in English

  Scenario: A short Croatian voice note is Croatian
    Given eleven seconds of Croatian
    When it is transcribed
    Then it is written in Croatian, not translated into English

  Scenario: A cut between two languages does not cut a word
    Given the language changes inside a run of speech
    When the recording is cut into stretches
    Then the cut moves to the nearest pause within ten seconds

  Scenario: A long talk is not mistaken for Whisper being stuck
    Given a transcript of an ordinary talk, long enough to gzip above 2.4 as a whole
    When it is checked for loops
    Then no 30 second stretch of it is above 2.4
    And it is not called stuck
