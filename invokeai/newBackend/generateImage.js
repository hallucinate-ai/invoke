import jimp from 'jimp'
import WebSocket from 'ws'
import fs from 'fs'
import { spawn } from 'child_process'
import { exec } from 'child_process';
import * as child_process from "child_process";
import * as enhanceImage from './enhanceImage.js'
import Jimp from 'jimp';


async function execute(command, args) {
    return new Promise((resolve, reject) => {
        const spawn = child_process.spawn(command, args)
        let result = ""
        spawn.stdout.on('data', (data) => {
            if (result) {
                //reject(Error('Helper function does not work for long lived proccess'))
            }
            result = data.toString()
        })
        spawn.stderr.on('data', (error) => {
			console.log(error)
            //reject(Error(error.toString()))
        })
        spawn.on('exit', code => {
            resolve({ code, result })
        })
    })
}

function addPerlinNoise(image, mask, width, height){
	// add perlin noise to the of the image that are transparent, and the parts of the mask that are black
	// read base64 image data with jimp 


	//var base64str="data:image/jpeg;base64," + image//base64 format of the image
	var buf = Buffer.from(image, 'base64');
	let output = jimp.read(buf, (err, image) => {
		if (err) throw err;
		else {
			for (let i = 0; i < width; i++){
				for (let j = 0; j < height; j++){
					let pixelColor = image.getPixelColor(i, j)
					let r = (pixelColor >> 16) & 0xff
					let g = (pixelColor >> 8) & 0xff
					let b = pixelColor & 0xff
					let a = (pixelColor >> 24) & 0xff
					if (r == 0 && g == 0 && b == 0 && a == 0){
						let perlinNoise = Math.floor(Math.random() * 255)
						r =  Math.floor(Math.random() * 255)
						g =  Math.floor(Math.random() * 255)
						b =  Math.floor(Math.random() * 255)
						a =  255
						image.setPixelColor(jimp.rgbaToInt(r, g, b, a), i, j)
					}
				}
			}
			image.write("addedPerlinNoise.png")
			console.log()
			//console.log( maskImage.getPixelColor(0, 0))
		}
	}).then((image) => {
		//return image
		return ([image, mask])
	});
	// read base64 image data with jimp
	//addedPerlinNoise.write("addedPerlinNoise.png")
}

export function main(request, request2, request3, timestamp, socket){
	// make websocket request to api.hallucinate.app and get the image
	console.log("Generating image")
	console.log(request)
	// generate a random id for the image
	let id = Math.floor(Math.random() * 1000000000)
	let cwd = process.cwd()
	//let dir = path.dirname(new URL(import.meta.url).pathname)	let timestamp = Date.now()
	let task = {
		"command": "diffuse",
		"model": 'stable-diffusion-v1.5',
		"prompt": request["prompt"],
		"width": request["width"],
		"height": request["height"],
		"sampler_name": 'k',
		"sampler_args": {
			"schedule": 'lms'
		},
		"cfg_scale": request["cfg_scale"],
		"denoising_strength": request["strength"],
		"steps": request["steps"],
		"seed": request["seed"],
		"timestamp": Date.now(),
		"input_image": request["init_img"],
		"mask_image": request["init_mask"],
		"id": id
	}
	let context = ""
	if (request["generation_mode"] != "txt2img"){
		context = request["init_img"]
		if(context != undefined){
			context = context.replace(/^data:image\/\w+;base64,/, "")
		}
	}

	let mask = request["init_mask"]
	if(mask  != undefined){
		mask = mask.replace(/^data:image\/\w+;base64,/, "")
	}
	if (request["generation_mode"] == "unifiedCanvas"){
		context = context.replace(/^data:image\/\w+;base64,/, "")
		mask = mask.replace(/^data:image\/\w+;base64,/, "")
		context = addPerlinNoise(context, mask, request["width"], request["height"])[0]
		context = fs.readFileSync("addedPerlinNoise.png", {encoding: 'base64'})
	}
	var output = {}
	var HallucinateAPI = new WebSocket('wss://api.hallucinate.app')
	const send = payload => HallucinateAPI.send(JSON.stringify(payload))

	HallucinateAPI.on('open', () => {
		let expectedBytes
		console.log('connection accepted')
		HallucinateAPI.on('message', raw => {
			let { event, ...payload } = JSON.parse(raw)
	
			switch (event) {
				case 'queue':
					console.log('position in queue is:', payload.position)
					break
				
				case 'progress':
					console.log(
						'progress:', 
						payload.stage, 
						payload.value
							? `${Math.round(payload.value * 100)}%`
							: ``
					)
					let progressDict = {
						"url": "data:image/png;base64,",							
						"isBase64": true,
						"mtime": 0,
						"metadata": {},
						"width": request["width"],
						"height": request["height"],
						"generationMode": request["generationMode"],
						"boundingBox": null
					}
					let currentStatus = ""
					if (request["generation_mode"] == "txt2img"){
						let currentStatus = "common:statusGeneratingTextToImage"
					} else if (request["generation_mode"] == "img2img"){
						let currentStatus = "common:statusGeneratingImageToImage"
					}
					socket.emit('IntermediateResult', progressDict);
					let output = {
						"currentStep": parseInt(request["steps"]) * payload.value,
						"totalSteps": request["steps"],
						"currentIteration": 1,
						"totalIterations": 1,
						"currentStatus": currentStatus,
						"isProcessing": true,
						"currentStatusHasSteps": true,
						"hasError": false
					}
					socket.emit("progressUpdate", output);
					break
	
				case 'error':
					console.log('error:', payload.message)
					break
	
				case 'result':
					if (fs.existsSync('./gallery/defaultUser/' + timestamp + '.png'))
						fs.unlinkSync('./gallery/defaultUser/' + timestamp + '.png')
	
					expectedBytes = payload.length
					console.log('compute finished: expecting', expectedBytes, 'bytes')
					console.log(payload)

					break
	
				case 'chunk':
					
					let blob = Buffer.from(payload.blob, 'base64')
	
					fs.appendFileSync('./gallery/defaultUser/' + timestamp + '.png', blob)
					expectedBytes -= blob.length
	
					console.log('received bytes:', expectedBytes, 'to go')
	
					if(expectedBytes <= 0){
						console.log('done')
						
						let output2 = {
							"currentStep": request["steps"],
							"totalSteps": request["steps"],
							"currentIteration": 1,
							"totalIterations": 1,
							"currentStatus": "common:statusGenerationComplete",
							"isProcessing": true,
							"currentStatusHasSteps": true,
							"hasError": false
						}
						socket.emit("progressUpdate", output2);

						let imagedata = fs.readFileSync('./gallery/defaultUser/' + timestamp + '.png', {encoding: 'base64'})
						//make a thumbnail with jimp
						let thumbnail = jimp.read('./gallery/defaultUser/' + timestamp + '.png').then(image => {
							image.resize(256, jimp.AUTO)
							image.getBase64(jimp.MIME_PNG, (err, src) => {
								let thumbnail = src.replace(/^data:image\/\w+;base64,/, "")
								// write the image to the gallery
								if(!fs.existsSync(cwd + '/gallery/defaultUser/' + timestamp + "-thumbnail.png")){
									fs.writeFileSync(cwd + '/gallery/defaultUser/' + timestamp + "-thumbnail.png", thumbnail, 'base64')
								}
							})
						})

						if(!fs.existsSync('./gallery/defaultUser/metadata.json')){
							let metadata = {}
							fs.writeFileSync('./gallery/defaultUser/metadata.json', JSON.stringify(metadata))
						}
						let metadata = ""
						if(fs.existsSync('./gallery/defaultUser/metadata.json')){
							metadata = fs.readFileSync('./gallery/defaultUser/metadata.json', 'utf8')
							metadata = JSON.parse(metadata)
							let imageMetadata =  {
								"model": "stable diffusion",
								"model_weights": "stable-diffusion-1.5",
								"model_hash": "cc6cb27103417325ff94f52b7a5d2dde45a7515b25c255d8e396c90014281516",
								"app_id": "invoke-ai/InvokeAI",
								"app_version": "2.2.5",
								"image": {
								  "prompt": [
									{
									  "prompt": request["prompt"],
									  "weight": 1
									}
								  ],
								  "steps": request["steps"],
								  "cfg_scale": request["cfg_scale"],
								  "threshold": request["threshold"],
								  "perlin": request["perlin"],
								  "height": request["height"],
								  "width": request["width"],
								  "seed": request["seed"],
								  "type": request["generation_mode"],
								  "postprocessing": null,
								  "sampler": request["sampler_name"],
								  "variations": []
								}
							}
							let index = timestamp.toString()
							metadata[index] = {}
							metadata[index] = imageMetadata
							fs.writeFileSync('./gallery/defaultUser/metadata.json', JSON.stringify(metadata))
							let command = "s3cmd --config="+cwd+"/cw-object-storage-config_stable-diffusion sync " + cwd + "/gallery/defaultUser/metadata.json s3://gallery/defaultUser/metadata.json"
							let results = child_process.execSync(command)
						}
						let tokens = request["prompt"].split(" ")
						for(let i = 0; i < tokens.length; i++){
							if(tokens[i].startsWith("-")){
								tokens[i] = tokens[i] + "</w>"
							}
						}
						let mtime = fs.statSync('./gallery/defaultUser/' + timestamp + '.png').mtime
						let bounding_box = {}
						if (Object.keys(request).includes("bounding_box")){
							bounding_box = request["bounding_box"]
						}

						
						let output3 = {
							"currentStep": request["steps"],
							"totalSteps": request["steps"],
							"currentIteration": 1,
							"totalIterations": 1,
							"currentStatus": "common:statusSavingImage",
							"isProcessing": true,
							"currentStatusHasSteps": true,
							"hasError": false
						}
						socket.emit("progressUpdate", output3);

						let enhanceResults = enhanceImage.main(request, request2, request3, timestamp, socket)
						//set timeout to 15 seconds
						if(request2 == false && request3 == false){

							let output4 = {
								"currentStep": 0,
								"totalSteps": 0,
								"currentIteration": 0,
								"totalIterations": 0,
								"currentStatus": "common:statusProcessingComplete",
								"isProcessing": false,
								"currentStatusHasSteps": true,
								"hasError": false
							}
							socket.emit("progressUpdate", output4);

							let template = {
								"url": "outputs/defaultUser/" + timestamp + ".png",
								"thumbnail": "outputs/defaultUser/" + timestamp + "-thumbnail.png",
								"mtime": mtime,
								"metadata":metadata,
								"dreamPrompt": "\""+ request["prompt"]+"\" -s "+ request["steps"] +" -S "+ request["seed"]+ " -W " + request["width"] +" -H " + request["height"] +" -C " + request["cfg_scale"] + " -A " + request["attention_maps"] + " -P " + request["perlin"] + " -T " + request["threshold"] + " -G " + request["generation_mode"] + " -M " + request["sampler_name"],
								"width": request["width"],
								"height": request["height"],
								"boundingBox": bounding_box,
								"generationMode": request["generation_mode"],
								"attentionMaps": "data:image/png;base64,",
								"tokens": tokens
							}
							socket.emit("generationResult", template)
						}
					}
					break
				}
			})
	
	
		if(context){
			send({
				command: 'upload_image',
				id: 'ctx',
				blob: context.toString('base64')
			})
			console.log('sent context')
		}
	
		if(mask){
			send({
				command: 'upload_image',
				id: 'mask',
				blob: mask.toString('base64')
			})
			console.log('sent mask')
		}
	
	
		send({
			...task,
			command: 'diffuse',
			id: 'task',
			input_image: context ? 'ctx' : undefined,
			mask_image: mask ? 'mask' : undefined,
		})
	
		console.log('sent task:', task)
		return output

	})

	HallucinateAPI.on('close', code => {
		console.log('socket closed: code', code)
	})

}
