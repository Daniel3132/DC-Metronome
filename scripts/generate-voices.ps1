# Renders the spoken count samples in public/voices using the Windows SAPI voices.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/generate-voices.ps1
# Then trim the silence:      node scripts/trim-voices.mjs
Add-Type -AssemblyName System.Speech

$packs = @(
  @{ Id = 'en-male';   Voice = 'Microsoft David Desktop';  Words = @{
      '1'='one'; '2'='two'; '3'='three'; '4'='four'; '5'='five'; '6'='six'; '7'='seven'; '8'='eight';
      '9'='nine'; '10'='ten'; '11'='eleven'; '12'='twelve'; '13'='thirteen'; '14'='fourteen'; '15'='fifteen'; '16'='sixteen';
      'e'='ee'; 'and'='and'; 'a'='uh'; 'trip'='trip'; 'let'='let' } },
  @{ Id = 'en-female'; Voice = 'Microsoft Zira Desktop';   Words = @{
      '1'='one'; '2'='two'; '3'='three'; '4'='four'; '5'='five'; '6'='six'; '7'='seven'; '8'='eight';
      '9'='nine'; '10'='ten'; '11'='eleven'; '12'='twelve'; '13'='thirteen'; '14'='fourteen'; '15'='fifteen'; '16'='sixteen';
      'e'='ee'; 'and'='and'; 'a'='uh'; 'trip'='trip'; 'let'='let' } },
  @{ Id = 'es-female'; Voice = 'Microsoft Helena Desktop'; Words = @{
      '1'='uno'; '2'='dos'; '3'='tres'; '4'='cuatro'; '5'='cinco'; '6'='seis'; '7'='siete'; '8'='ocho';
      '9'='nueve'; '10'='diez'; '11'='once'; '12'='doce'; '13'='trece'; '14'='catorce'; '15'='quince'; '16'='dieciseis';
      'e'='i'; 'and'='y'; 'a'='a'; 'trip'='tri'; 'let'='ple' } }
)

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$root = Join-Path (Get-Location) 'public/voices'

foreach ($pack in $packs) {
  $dir = Join-Path $root $pack.Id
  New-Item -ItemType Directory -Force $dir | Out-Null
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($pack.Voice)
  $synth.Rate = 3
  foreach ($key in $pack.Words.Keys) {
    $synth.SetOutputToWaveFile((Join-Path $dir "$key.wav"), $format)
    $synth.Speak($pack.Words[$key])
  }
  $synth.SetOutputToNull()
  $synth.Dispose()
}
