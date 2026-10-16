# Separate microphone gain from diagnostic detection tuning

Microphone Input gain changes incoming PCM before both detection and retention; imported audio is preserved. Import/replay Detection sensitivity is a diagnostic adjustment of the shared detector, isolated from live defaults so a setting that fixes one passage cannot silently change live behavior. Reported passages and settings inform deliberate algorithm improvements checked against regressions, rather than automatic adaptation; the single user control leaves internal detector parameters free to evolve.
