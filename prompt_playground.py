"""
prompt_playground.py
└─ 1) change_tone()  문체·톤 변환
   2) summarize()    핵심 요약
"""

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()

def change_tone(text: str, tone: str = "friendly") -> str:
    """문장을 원하는 분위기로 바꿔 준다."""
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        max_tokens=120,          # 비용 절약용!
        messages=[
            {"role": "system",
             "content": ("You are a writing assistant. "
                         "Rephrase the user's text in the requested tone.")},
            {"role": "user",
             "content": f"Tone: {tone}\n\nText:\n{text}"}
        ]
    )
    return response.choices[0].message.content.strip()

def summarize(text: str, style: str = "bullet") -> str:
    """긴 글을 요약 – bullet / paragraph / headline 중 선택."""
    instructions = {
        "bullet": "Summarize into 3~5 concise bullet points.",
        "paragraph": "Summarize into one short paragraph (<= 70 words).",
        "headline": "Give me a single catchy headline summarizing the text."
    }
    prompt = instructions.get(style, instructions["bullet"])
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        max_tokens=120,
        messages=[
            {"role": "system",
             "content": "You are a smart summarizer."},
            {"role": "user",
             "content": prompt + "\n\n" + text}
        ]
    )
    return response.choices[0].message.content.strip()

# === 직접 실행용 테스트 코드 ===
if __name__ == "__main__":
    sample = "책 읽기는 지루하다고 생각했는데, 최근에 친구가 추천한 소설을 읽고 완전히 빠져버렸다!"
    print("원문:", sample)
    print("\n[톤 변환 — 격식체]")
    print(change_tone(sample, "formal"))
    print("\n[요약 — 헤드라인]")
    print(summarize(sample, "headline"))
