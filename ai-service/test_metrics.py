from app.services.metrics import calculate_metrics

# Simulamos lo que nos devolvería AssemblyAI
mock_words = [
    {"text": "Well,", "start": 0, "end": 500},
    {"text": "I", "start": 600, "end": 800},
    {"text": "actually", "start": 850, "end": 1200}, # Muletilla
    {"text": "think", "start": 1300, "end": 1700},
    {"text": "think", "start": 1750, "end": 2100}, # Repetición
    {"text": "that", "start": 4500, "end": 4800}    # Pausa larga (2400ms de hueco)
]

print("Calculando métricas con datos de prueba...")
resultado = calculate_metrics(mock_words, language="en")

print("\n📊 RESULTADOS:")
for key, value in resultado.items():
    print(f"- {key}: {value}")