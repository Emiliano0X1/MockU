def calculate_metrics(words_data: list, language: str = "en") -> dict:
    """
    Recibe la lista de palabras con timestamps generada por AssemblyAI y calcula
    métricas de comunicación.
    """
    # Manejo de error si el audio estaba vacío
    if not words_data:
        return {
            "duration_seconds": 0.0,
            "speech_rate_wpm": 0.0,
            "filler_count": 0,
            "long_pause_count": 0,
            "repetitions_count": 0
        }

    # 1. Duración (en segundos)
    # Tomamos el tiempo de la última palabra y le restamos la primera
    start_time_ms = words_data[0]["start"]
    end_time_ms = words_data[-1]["end"]
    duration_seconds = (end_time_ms - start_time_ms) / 1000.0

    # Evitamos división por cero en audios de menos de 1 segundo
    if duration_seconds <= 0:
        duration_seconds = 1.0 

    # 2. Palabras por minuto (WPM)
    word_count = len(words_data)
    duration_minutes = duration_seconds / 60.0
    wpm = round(word_count / duration_minutes)

    # 3. Diccionarios de muletillas simples
    fillers_es = {"este", "eh", "ah", "bueno", "digamos"}
    fillers_en = {"um", "uh", "like", "actually", "basically"}
    target_fillers = fillers_es if language == "es" else fillers_en
    
    filler_count = 0
    long_pause_count = 0
    repetitions_count = 0
    
    # Umbral de pausa larga: 2000 milisegundos (2 segundos) sin hablar
    PAUSE_THRESHOLD_MS = 2000 

    # 4. Iteración principal
    for i, word_obj in enumerate(words_data):
        # Limpiamos puntos y comas para comparar bien la palabra
        word_text = word_obj["text"].lower().strip(".,!?")
        
        # A. Conteo de muletillas
        if word_text in target_fillers:
            filler_count += 1
            
        if i > 0:
            prev_word_obj = words_data[i-1]
            prev_word_text = prev_word_obj["text"].lower().strip(".,!?")
            
            # B. Repeticiones (ej: "the the")
            if word_text == prev_word_text:
                repetitions_count += 1
                
            # C. Pausas largas (Diferencia entre el inicio de esta palabra y el fin de la anterior)
            gap = word_obj["start"] - prev_word_obj["end"]
            if gap > PAUSE_THRESHOLD_MS:
                long_pause_count += 1

    return {
        "duration_seconds": round(duration_seconds, 2),
        "speech_rate_wpm": wpm,
        "filler_count": filler_count,
        "long_pause_count": long_pause_count,
        "repetitions_count": repetitions_count
    }