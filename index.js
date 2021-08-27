require("ts-node").register({
  compilerOptions: {
    module: "commonjs",
    target: "esnext",
  },
  transpileOnly: true,
});

const requireESM = require("esm")(module);

const { micromark } = requireESM("micromark");
const { defList } = requireESM("./syntax");

const md = `term
: description
  continuous line
`;

micromark(md, {
  extensions: [defList],
});
