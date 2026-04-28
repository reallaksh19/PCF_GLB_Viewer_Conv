const fs = require('fs');
const data = JSON.parse(fs.readFileSync('RHBG.json', 'utf8'));

function findNodes(nodes, keyword) {
    let results = [];
    for (const node of nodes) {
        if (node.name && node.name.includes(keyword)) {
            results.push(node);
        }
        if (node.children) {
            results = results.concat(findNodes(node.children, keyword));
        }
    }
    return results;
}

const elbows = findNodes(data, "ELBOW");
const pipes = findNodes(data, "PIPE");
const flanges = findNodes(data, "FLANGE");

console.log("Elbows:", elbows.length > 0 ? elbows[0] : "none");
console.log("Pipes:", pipes.length > 0 ? pipes[0].name : "none");
if(pipes.length > 0 && pipes[0].children) {
    console.log("First pipe children count:", pipes[0].children.length);
    if(pipes[0].children.length > 0) {
        console.log("First pipe child:", pipes[0].children[0]);
    }
}
