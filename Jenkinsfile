pipeline {
    agent none
    stages {
        stage('Image creation & image push') {
            agent any
            options {
                skipDefaultCheckout true
            }
            steps {
                echo 'Creating the VDC image...' 

                sh "docker build -t \"ditas/ideko-use-case\" -f Dockerfile ."
                echo "Done"
		    
                echo 'Retrieving Docker Hub password from /opt/ditas-docker-hub.passwd...'
                script {
                    password = readFile '/opt/ditas-docker-hub.passwd'
                }
                echo "Done"

                echo 'Login to Docker Hub as ditasgeneric...'
                sh "docker login -u ditasgeneric -p ${password}"
                echo "Done"

                echo "Pushing the image ditas/ideko-use-case:latest..."
                sh "docker push ditas/ideko-use-case:latest"
                echo "Done "
            }
        }
        stage('Image deploy') {
            agent any
            options {
                skipDefaultCheckout true
            }
            steps {
                // sh './jenkins/deploy/deploy-staging.sh' 
		echo "continue..."
            }
        }
    }
}
