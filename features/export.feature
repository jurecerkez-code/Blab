Feature: Handing a recording to someone else
  Copy all covers pasting a recording into an AI or an email. It does not cover
  the times someone wants a file — an attachment, something to drop in a shared
  drive, something to keep beside an essay. Two buttons write that file
  wherever you point them, and nothing about the recording's own folder
  changes.

  Background:
    Given I am reading a recording

  Scenario: Saving markdown
    When I press Save .md
    And I choose where it goes
    Then one file is written there
    And it holds the title, the date, the highlights, my notes and the full transcript
    And the recording's own folder is untouched

  Scenario: Saving plain text
    When I press Save .txt
    Then the same content is written without the markdown marks
    And it is readable in any editor that has never heard of markdown

  Scenario: Closing the dialog is not a failure
    When I press Save .md
    And I close the save dialog without choosing anything
    Then nothing is written
    And no error is shown, because nothing went wrong

  Scenario: The transcript goes in whole
    Given a recording with an hour of transcript
    When I export it
    Then the whole hour is in the file
    And the highlights sit above it rather than in place of it

  Scenario: A browser with no save dialog still gets the file
    Given a browser without showSaveFilePicker
    When I press Save .md
    Then the file is downloaded instead
    And it lands wherever that browser puts downloads

  Scenario: Nothing leaves the machine
    When I export in any format
    Then no network request is made
    And the file is written straight to disk
