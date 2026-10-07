# Sons personalizados da chamada de voz

Coloque seus arquivos de áudio nesta pasta com estes nomes exatos:

| Arquivo | Evento | Quando toca |
|---------|--------|-------------|
| `join.mp3` | 🔊 Entrada | Quando um usuário entra na chamada |
| `leave.mp3` | 🔕 Saída | Quando um usuário sai da chamada |
| `stream.mp3` | 📡 Transmissão | Quando alguém liga câmera ou compartilha tela |

Formato suportado: `.mp3`, `.wav`, `.ogg`, `.m4a`

## Dicas
- Se um arquivo não existir, o app usa um beep automático como fallback (não quebra nada).
- Sons curtos (0.5s - 2s) funcionam melhor.
- Depois de adicionar, pode ser necessário limpar o cache do navegador (Ctrl+F5) para ouvir a nova versão.

Exemplos de uso já existentes na raiz de `public/`:
- `chatnot.mp3` (notificação de mensagem)
- `nasala.mp3` (entrada na chamada - legado)
- `accessdenied.mp3` (erro/acesso negado)
