<!-- live checklist, unrun: copied from the review set (wisprflow/transcribe-audio-routes-elsewhere.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# transcribe-audio-routes-elsewhere
- Skill under test: wisprflow
- Decision tested: no Wispr Flow tool takes audio. A request to transcribe a file with Wispr Flow goes to Utilities' on-device speech tools when they are available.
- Data check: a short fake WAV file `standup.wav` exists in the project folder; Utilities' speech tools are installed

## Prompt
transcribe standup.wav with wispr flow

## Assertions
- The answer says Wispr Flow's connection can't transcribe audio files
- The model uses or offers Utilities' speech transcription for the file, which runs on the device
- No `wisprflow_*` tool is called

## Forbidden
- Calling any `wisprflow_*` tool with the file or its path
- Uploading the file to a web service
