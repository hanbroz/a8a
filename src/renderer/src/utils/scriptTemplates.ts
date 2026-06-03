export const DEFAULT_PRE_REQUEST_SCRIPT = 'const input = getInput();'
export const DEFAULT_POST_RESPONSE_SCRIPT = 'const output = getOutput();'

export const PRE_REQUEST_EXAMPLE = `${DEFAULT_PRE_REQUEST_SCRIPT}

// API URL, Header, Body에서 [[customerId]] 또는 <<customerId>>로 사용할 수 있습니다.
setInput("customerId", input.customerId);

// 이후 요청에서 {{token}}으로 사용할 수 있습니다.
setEnv("token", input.token);

console.log("customerId", input.customerId);`

export const POST_RESPONSE_EXAMPLE = `${DEFAULT_POST_RESPONSE_SCRIPT}

// OUTPUT 전체를 단순한 객체로 교체합니다.
setOutput({
  orderId: output.orderId,
  currencyCode: output.currencyCode
});

// 또는 이름/값 형태로 OUTPUT 필드를 추가할 수 있습니다.
setOutput("orderId", output.orderId);`

export const POST_OUTPUT_OBJECT_EXAMPLE = `${DEFAULT_POST_RESPONSE_SCRIPT}
const next = new Output();

next.add("from", output.results?.[0]?.trips?.[0]);
next.add("to", output.results?.[1]?.trips?.[0]);

setOutput(next);`
