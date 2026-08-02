export const tutorialMessage = `
🔥 Comandos do Pimpão Bot 🤖🧙‍♂️  
## Todos os comandos devem ser iniciados com o ponto de exclamação (\`!\`).

### 📋 **Lista de Comandos**  

- **\`camisa7\`**  
   Mostra a contagem atualizada de sócios do plano * Camisa 7 *.

- **\`c [mensagem]\`**  
   Cita um usuário no tópico, com a opção de incluir uma mensagem personalizada.

- **\`gsd\`**  
   Agradece o * ritual do mago Duds * pela magia da GSD.

- **\`antizica\`**  
   Elimina energias negativas e afasta qualquer tentativa de *zica*.

- **\`mongol\`**  
   De forma amigável e descontraída, lembra que o usuário mencionado *é meio mongolóide*.  

- **\`upem\`**  
   Envia o link para o tópico das coisas que "você só conhece pela comunidade".

- **\`remind\` ou \`!r [tempo]\`**  
   Cria um lembrete e cita você após o tempo especificado.  
   **Exemplo:** \`!r 10 dias\`  

- **\`mensagem\` ou \`!m\`**  
   Envia uma mensagem privada com o **link** e **título do tópico**.  
   > * Importante: * Para usar este comando, você precisa seguir a página do bot e enviar uma mensagem para ativá-lo.

---
`;

export const gsdMessages = ['Gracias Señor Duds!'] as const;
export const antiZicaMessages = ['🤖 ¡AntiZica ativado!'] as const;
export const antiGsdMessages = ['MONGOLOIDE'] as const;

export function randomItem<T>(items: readonly T[], random = Math.random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Lista de mensagens vazia');
  return item;
}
