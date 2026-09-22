Feature: The installer contains the models it offers
  Blab ships its speech models inside the installer. That is the whole basis of
  the promise on the front of the README: install it once and it never touches
  the network again. It also means the build has exactly one chance to get the
  contents right, and no way to notice later — an installer with no weights in
  it is the same shape and very nearly the same name as one that works.

  `npm run setup` is what puts them there. It takes the name of a model, or
  `all`, or `clean`, or nothing at all. Then it prunes, because electron-builder
  copies public/models wholesale and a model left behind by an older version of
  the catalog is pure installer weight that nothing will ever load.

  Every scenario below is a rule that has already been broken in a shipped
  release. `npm run setup` with no argument threw, which killed every release
  build from 0.7.0 to 0.7.5 before it compiled a line and left the project
  shipping hand-built Windows installers alone. `npm run setup all` then
  downloaded 1,059 MB and deleted all of it, because the prune was handed an
  empty keep-list, which does not mean keep everything. Both were invisible:
  the script printed "all on disk" either way.

  The decision lives in scripts/model-plan.mjs, apart from the downloading, so
  that it can be held to this.

  Background:
    Given the catalog offers the fast, balanced and best models
    And the voice-activity detector is not one of them

  # ------------------------------------------------------------------ fetching

  Scenario: No argument fetches the model the header promises
    Given I run setup with no argument
    Then the fast model is fetched
    And nothing is pruned, because nothing was asked about

  Scenario: Naming a model fetches that one
    Given I run setup naming the balanced model
    Then the balanced model is fetched
    And no other model is touched

  Scenario: Asking for everything fetches the whole catalog
    Given I run setup with "all"
    Then all three models are fetched

  Scenario: An argument that names no model stops rather than guesses
    Given I run setup with a word that is not a model
    Then it fails, and says which names it would have taken

  # ------------------------------------------------------------------ keeping

  Scenario: Everything fetched is everything kept
    Given I run setup with "all"
    Then all three models survive
    # The bug: an empty keep-list was read as "keep the lot" and meant the
    # opposite. A build fetched a gigabyte and shipped an empty installer.

  Scenario: The prune still removes a model that left the catalog
    Given a model from an older catalog is on disk
    When I run setup with "all"
    Then that model is removed
    And the three in the catalog are not

  Scenario: Cleaning goes back to the fast model alone
    Given every model is on disk
    When I run setup with "clean"
    Then the fast model survives
    And the balanced and best models are removed

  Scenario: The detector is never collateral
    Given the voice-activity detector is on disk
    When I run setup with "all" or with "clean"
    Then the detector survives both
    # It is not a Whisper model and is never what the argument is about, but
    # both prunes used to take it, and silence detection went with it.

  Scenario: Models accumulate when no one asked otherwise
    Given the balanced model is already on disk
    When I run setup naming the best model
    Then both are on disk
    # Which model the app loads is a runtime choice, so setup keeps whatever it
    # has ever fetched until told to clean.
