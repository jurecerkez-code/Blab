Feature: The lines worth going back to
  Blab does not summarise. It picks: every line under "Worth going back to" was
  said out loud in the recording and is quoted whole, with the time it was said
  at. A wrong pick costs you a dull line. A summary written by a small local
  model would cost you a decision nobody took, stated confidently, on exactly
  the transcripts that are already hardest to trust.

  Two things decide it. What the talk keeps returning to, and where you were
  typing — a note written at fourteen minutes says the speaker was worth
  writing down at fourteen minutes, and no statistic beats someone who was in
  the room.

  Background:
    Given Blab is open with a folder connected

  Scenario: Nothing is invented
    Given a transcribed recording
    Then every highlight appears word for word in the transcript
    And no highlight joins two lines together
    And no highlight rephrases anything

  Scenario: The subject of the talk beats the chat around it
    Given a talk that keeps returning to two subjects
    Then the highlights are about those subjects
    And "thanks everyone, see you next week" is not among them

  Scenario: What I wrote down counts
    Given a line the statistics rate as ordinary
    And a note I typed eight seconds after that line was said
    Then that line is promoted into the highlights

  Scenario: A note does not lift a line it was nowhere near
    Given a note typed ten minutes away from a line
    Then that line is not promoted

  Scenario: A short recording gets no highlights at all
    Given a recording with fewer than a dozen lines of transcript
    Then no highlights are shown
    And nothing is padded out to fill the space

  Scenario: A stuck Whisper loop is not a highlight three times over
    Given a transcript where one phrase repeats
    Then that phrase appears at most once in the highlights

  Scenario: Highlights never stand in for the transcript
    Given a recording with highlights
    Then the full transcript is shown below them
    And the full transcript is in Copy all
    And the full transcript is in every export

  Scenario: An older recording with no times still gets highlights
    Given a transcript.md written before Blab kept times
    Then it is cut into sentences and highlighted the same way
    And those highlights show no time, because none was recorded

  Scenario: It costs nothing to ship
    Then no model is downloaded for this
    And no dependency is added to package.json
    And the installer is the same size it was
    And the picking is done before the panel finishes opening

  Scenario Outline: It works in both languages Blab transcribes
    Given a transcript in <language>
    Then the words that hold sentences together are ignored
    And the words the talk is about are what decides the picks

    Examples:
      | language  |
      | English   |
      | Croatian  |
