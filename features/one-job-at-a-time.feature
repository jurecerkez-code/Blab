Feature: One transcription at a time
  Whisper runs in a worker, and the worker keeps the loaded model between jobs
  because loading it again costs ten seconds. That saving is the reason the
  queue has to be real: transformers.js holds decoder state on the pipeline it
  caches, so two generations running against it at once are two generations
  sharing one set of buffers.

  Overlapping jobs are not a corner case here. The README offers them as a
  feature — "it runs in the background, so you can start recording the next
  talk while the last one is still going" — so the second Record press is an
  ordinary thing to do, and the queue is what makes it safe.

  The queue read as though it did this. It did not. `track(this.send(...))`
  evaluates the send first, and the send posts to the worker synchronously
  inside its Promise executor, so the job was already in the worker's message
  queue before anything was chained. What the chain sequenced was when each
  caller heard back, not when each job began. Two recordings finishing close
  together ran two generations at once on one cached pipeline.

  Background:
    Given the transcription worker is loaded

  Scenario: A second job waits for the first to finish
    Given a recording is being transcribed
    When a second recording is handed over before the first is done
    Then the worker is not asked to start the second until the first has ended

  Scenario: Both callers still get their own transcript
    Given two recordings were handed over back to back
    When both have finished
    Then each caller is given the transcript belonging to its own recording

  Scenario: A live caption is dropped rather than queued
    Given a recording is being transcribed
    When a caption window is offered
    Then it is dropped
    # A caption computed a minute late is not a caption, and the recording must
    # never wait behind one.

  Scenario: A caption is accepted when nothing else is running
    Given nothing is being transcribed
    When a caption window is offered
    Then the worker is asked for it

  Scenario: A job that fails does not wedge the queue
    Given a recording is being transcribed
    And it fails
    When another recording is handed over
    Then it is still transcribed
