from dotenv import load_dotenv
from openai import OpenAI
import gradio as gr

load_dotenv()
client = OpenAI()

def translate(text):
    """한국어 문장을 영어로 번역해 주는 함수"""
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        max_tokens=120,
        messages=[
            {"role": "user",
             "content": f"Translate the following to natural English:\n\n{text}"}
        ]
    )
    return response.choices[0].message.content.strip()

# Gradio UI 정의
demo = gr.Interface(
    fn=translate,          # 버튼을 누르면 실행할 함수
    inputs="text",         # 사용자 입력 타입
    outputs="text",        # 출력 타입
    title="한 줄 번역기",
    description="한국어 문장을 영어로 바꿔 줍니다"
)

if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", share=False, show_error=True, inbrowser=True)          # 브라우저 창 자동 오픈
