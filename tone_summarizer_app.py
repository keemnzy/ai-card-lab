from prompt_playground import change_tone, summarize
import gradio as gr

with gr.Blocks() as demo:
    gr.Markdown("# ✨ Text Styler & Summarizer")
    inp = gr.Textbox(label="원본 문장이나 단락 입력")
    tone = gr.Dropdown(["friendly", "formal", "gen-Z", "cheerful"], label="Tone")
    style = gr.Dropdown(["bullet", "paragraph", "headline"], label="Summary Style")
    btn_tone = gr.Button("톤 변환")
    btn_sum  = gr.Button("요약")
    out = gr.Textbox(label="출력")

    btn_tone.click(change_tone, inputs=[inp, tone], outputs=out)
    btn_sum.click(summarize, inputs=[inp, style], outputs=out)

demo.launch()
