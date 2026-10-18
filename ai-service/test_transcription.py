from app.services.transcription import transcribe_audio

# short public audio provided by Assembly AI for testing
AUDIO_URL = "https://assembly.ai/wildfires.mp3"

print("Sending audio to AssemblyAI.....")

try:
  result = transcribe_audio(AUDIO_URL)
  
  print("\n Transcription succesful")
  print("-"*30)
  print("FULL TEXT:")
  print(result["full_text"])
  print("-"*30)
  print("FIRST 5 WORDS WITH TIMESTAMPS")
  for word in result["words"][:5]:
    print(f"Word: '{word['text']:<10}' | Start: {word['start']}ms | End: {word['end']}ms")
except Exception as e:
  print(f"Error: {e}")
  
    
  